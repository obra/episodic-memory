import * as fs from 'fs';
import type { ConversationExchange } from './types.js';

/**
 * Sentinel file format for `<archive>/<project>/<session>-summary.txt`:
 *
 * - File missing → conversation has not been processed; queue for summarization.
 * - File empty → permanent skip (zero-exchange / metadata-only file; #91).
 * - File starts with `__ERRORED__\n` → previous summarization failed.
 *   Skip-then-retry: if mtime is older than the retry threshold, the file is
 *   re-queued; otherwise it's treated as "recently failed, leave alone".
 * - Anything else → real summary content.
 *
 * The error-marker path is what fixes #96: previously a failed summarization
 * wrote no sentinel at all, so the file re-queued every sync run forever and
 * could pin the head of the queue.
 */
export const ERROR_MARKER = '__ERRORED__';
const ERROR_MARKER_PREFIX = `${ERROR_MARKER}\n`;

// Time thresholds are configured in hours (the `_HOURS` env vars) and consumed in
// milliseconds; convert at this single boundary so the two units never mix.
const MS_PER_HOUR = 3600_000;
const DEFAULT_ERROR_RETRY_HOURS = 1;
const DEFAULT_SUMMARY_MAX_ATTEMPTS = 5;

export const COVERAGE_SCHEMA = 1;
const COVERAGE_PREFIX = '__COVERAGE__ ';

/**
 * Attempt-counted failure state shared by both failure stores — the error
 * sentinel (no good summary yet) and a preserved good summary's `resummary`
 * field. Drives the unified backoff-and-give-up in shouldRetryAfterFailure: hold
 * off until the retry floor elapses, then give up once the attempt budget is
 * spent. Cleared when a summary finally succeeds.
 */
export interface FailureState {
  /** Consecutive failed attempts since the last successful summary. */
  attempts: number;
  /** Epoch ms of the last failed attempt — gates the per-attempt retry floor. */
  lastAttempt: number;
}

/**
 * Machine-readable header recording how much of a transcript a summary
 * reflects. Stored as the first line of a real summary file so a later
 * sync can detect transcript growth and re-queue for re-summarization.
 */
export interface SummaryCoverage {
  /** Archive JSONL byte size the summary reflects. Growth past this re-queues. */
  bytes: number;
  /** Timestamp of the last exchange the summary covered (diagnostic). */
  lastExchange?: string;
  schema: number;
  /** Present only after a re-summary has failed; absent on a healthy summary. */
  resummary?: FailureState;
}

/** Serialize a real summary with its coverage header as the first line. */
export function formatSummaryFile(coverage: SummaryCoverage, body: string): string {
  return `${COVERAGE_PREFIX}${JSON.stringify(coverage)}\n${body}`;
}

/**
 * Split a summary file into its coverage header (if present) and body.
 * A header-less file is legacy: coverage is null and the whole content is body.
 * A present-but-corrupt header line is stripped (never leaked into the body).
 */
export function parseSummaryFile(content: string): { coverage: SummaryCoverage | null; body: string } {
  if (!content.startsWith(COVERAGE_PREFIX)) {
    return { coverage: null, body: content };
  }
  const newlineIndex = content.indexOf('\n');
  const headerJson = content.slice(COVERAGE_PREFIX.length, newlineIndex === -1 ? undefined : newlineIndex);
  const body = newlineIndex === -1 ? '' : content.slice(newlineIndex + 1);
  let coverage: SummaryCoverage | null = null;
  try {
    const parsed = JSON.parse(headerJson);
    // Validate only `bytes` (the growth signal); schema-version handling is deferred to the consumer.
    if (parsed && typeof parsed.bytes === 'number') coverage = parsed as SummaryCoverage;
  } catch {
    coverage = null;
  }
  return { coverage, body };
}

/**
 * Serialize an error sentinel: the marker, a JSON failure-state line (attempts +
 * lastAttempt), then the human-readable error message. The failure state lets
 * shouldQueueForSummary back off and give up identically to a re-summary failure.
 */
export function formatErrorSentinel(error: unknown, failure: FailureState): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${ERROR_MARKER}\n${JSON.stringify(failure)}\n${message}\n`;
}

export function isErroredSentinel(content: string): boolean {
  return content.startsWith(ERROR_MARKER_PREFIX);
}

/**
 * Read the failure state from an error sentinel. Tolerates the legacy
 * `__ERRORED__\n<ISO timestamp>\n<message>` form (no attempt count): the ISO
 * time becomes lastAttempt and attempts starts at 0, so an upgraded sentinel
 * keeps backing off correctly and recordSummaryFailure resumes counting.
 */
export function parseErrorSentinel(content: string): FailureState {
  const secondLine = content.split('\n', 2)[1] ?? '';
  try {
    const parsed = JSON.parse(secondLine);
    if (parsed && typeof parsed.attempts === 'number' && typeof parsed.lastAttempt === 'number') {
      return { attempts: parsed.attempts, lastAttempt: parsed.lastAttempt };
    }
  } catch { /* legacy ISO-timestamp form */ }
  const legacyTime = Date.parse(secondLine);
  return { attempts: 0, lastAttempt: Number.isNaN(legacyTime) ? 0 : legacyTime };
}

/** Resolve an `_HOURS` env var to milliseconds, falling back to defaultHours for
 *  undefined/garbage. allowZero=false rejects 0 too (used for retry backoff). */
function resolveHoursEnvMs(name: string, defaultHours: number, allowZero: boolean): number {
  const defaultMs = defaultHours * MS_PER_HOUR;
  const raw = process.env[name];
  if (raw === undefined) return defaultMs;
  const hours = parseFloat(raw);
  if (!Number.isFinite(hours)) return defaultMs;
  if (allowZero ? hours < 0 : hours <= 0) return defaultMs;
  return hours * MS_PER_HOUR;
}

/** The retry floor: minimum idle time between failed summary attempts (a
 *  first-time failure or a re-summary alike). Configurable in hours; default 1h. */
function getRetryFloorMs(): number {
  return resolveHoursEnvMs('EPISODIC_MEMORY_SUMMARY_ERROR_RETRY_HOURS', DEFAULT_ERROR_RETRY_HOURS, false);
}

/**
 * Failed summary attempts to make before giving up — keeping whatever good
 * summary exists (none, for a first-time failure). Bounds cost on a transcript
 * that never summarizes. Configurable for operators/tests; falls back for garbage.
 */
export function getMaxSummaryAttempts(): number {
  const raw = process.env.EPISODIC_MEMORY_SUMMARY_MAX_ATTEMPTS;
  if (raw === undefined) return DEFAULT_SUMMARY_MAX_ATTEMPTS;
  const attempts = parseInt(raw, 10);
  return Number.isInteger(attempts) && attempts >= 0 ? attempts : DEFAULT_SUMMARY_MAX_ATTEMPTS;
}

/**
 * The single retry/give-up policy for any recorded summary failure: hold off
 * until the retry floor has elapsed, then give up once the attempt budget is
 * spent. Shared by the error-sentinel and re-summary paths so they stay in lockstep.
 */
function shouldRetryAfterFailure(failure: FailureState): boolean {
  if (failure.attempts >= getMaxSummaryAttempts()) return false;
  return Date.now() - failure.lastAttempt >= getRetryFloorMs();
}

/**
 * True when the sentinel at `summaryPath` represents a real summary —
 * a file with a non-empty summary body that is not an error marker. Empty
 * zero-exchange sentinels, header-only files (empty body), and error sentinels
 * all return false. Use this for callers that care about "is this conversation
 * summarized and useful" (stats, verify, search).
 */
export function hasRealSummary(summaryPath: string): boolean {
  if (!fs.existsSync(summaryPath)) return false;
  let content: string;
  try {
    content = fs.readFileSync(summaryPath, 'utf-8');
  } catch {
    return false;
  }
  if (content.length === 0) return false;
  if (isErroredSentinel(content)) return false;
  return parseSummaryFile(content).body.trim().length > 0;
}

/** Attempts already recorded in an existing error sentinel, or 0 when there is
 *  no sentinel (or it can't be read). Lets a repeat first-failure keep counting. */
function readErrorAttempts(summaryPath: string): number {
  try {
    const content = fs.readFileSync(summaryPath, 'utf-8');
    return isErroredSentinel(content) ? parseErrorSentinel(content).attempts : 0;
  } catch {
    return 0;
  }
}

/**
 * Record a summary failure, incrementing the attempt count. Best-effort —
 * swallows its own IO errors. Both branches feed the same backoff/give-up policy
 * (shouldRetryAfterFailure); a successful writeSummary later clears the state.
 *  - No prior real summary: write an attempt-counted error sentinel (#96).
 *  - Prior real summary exists: keep the good body but stamp the attempt + time
 *    into its `resummary` header, so the last good summary survives the failure.
 */
export function recordSummaryFailure(summaryPath: string, error: unknown): void {
  try {
    const now = Date.now();
    if (!hasRealSummary(summaryPath)) {
      const attempts = readErrorAttempts(summaryPath) + 1;
      fs.writeFileSync(summaryPath, formatErrorSentinel(error, { attempts, lastAttempt: now }), 'utf-8');
      return;
    }
    const { coverage, body } = parseSummaryFile(fs.readFileSync(summaryPath, 'utf-8'));
    // A legacy header-less good summary is never re-queued (shouldQueueForSummary
    // returns false for null coverage), so leave it untouched rather than guessing a baseline.
    if (coverage === null) return;
    const attempts = (coverage.resummary?.attempts ?? 0) + 1;
    const updated: SummaryCoverage = { ...coverage, resummary: { attempts, lastAttempt: now } };
    fs.writeFileSync(summaryPath, formatSummaryFile(updated, body), 'utf-8');
  } catch {}
}

/**
 * True when the conversation at `summaryPath` should be (re-)summarized:
 *  - no summary yet,
 *  - a stale error marker, or
 *  - a real summary whose covered byte size is below the current archive size
 *    (the transcript has grown — append-only, so a size increase means new content).
 * Both a stale error marker and a grown summary carrying failed-re-summary state
 * are governed by shouldRetryAfterFailure — held back until the retry floor
 * elapses, then abandoned once getMaxSummaryAttempts() is spent (keeping any good
 * summary) so a never-summarizable transcript can't thrash.
 * A legacy header-less summary returns false; callers must call
 * ensureCoverageBaseline first so a baseline exists and future growth is detected.
 */
export function shouldQueueForSummary(summaryPath: string, currentArchiveBytes: number): boolean {
  if (!fs.existsSync(summaryPath)) return true;
  let content: string;
  try {
    content = fs.readFileSync(summaryPath, 'utf-8');
  } catch {
    return false;
  }
  if (content.length === 0) return false;
  if (isErroredSentinel(content)) {
    return shouldRetryAfterFailure(parseErrorSentinel(content));
  }
  const { coverage } = parseSummaryFile(content);
  if (coverage === null) return false; // legacy; caller must have stamped a baseline via ensureCoverageBaseline
  if (currentArchiveBytes <= coverage.bytes) return false; // transcript hasn't grown

  // Transcript grew. A prior failed re-summary backs off / gives up under the
  // same policy as a first-time failure; otherwise re-summarize the new content.
  return coverage.resummary ? shouldRetryAfterFailure(coverage.resummary) : true;
}

const DEFAULT_QUIESCENCE_HOURS = 1;

/** Idle time a conversation must reach before it is (re)summarized.
 *  Allows 0 (summarize immediately, e.g. in tests); rejects negative/garbage. */
export function getQuiescenceMs(): number {
  return resolveHoursEnvMs('EPISODIC_MEMORY_SUMMARY_QUIESCENCE_HOURS', DEFAULT_QUIESCENCE_HOURS, true);
}

/**
 * True when the conversation has been idle for at least the quiescence window.
 * Uses the last exchange's timestamp (file mtime is unreliable — the archive
 * copy's mtime is reset every sync). A missing/unparseable timestamp is treated
 * as quiescent so it never blocks summarization.
 */
export function isQuiescent(exchanges: ConversationExchange[], nowMs: number): boolean {
  const last = exchanges[exchanges.length - 1];
  if (!last?.timestamp) return true;
  const ts = Date.parse(last.timestamp);
  if (Number.isNaN(ts)) return true;
  return nowMs - ts >= getQuiescenceMs();
}

/** Coverage metadata for the conversation currently archived at `archiveJsonlPath`. */
export function buildCoverage(archiveJsonlPath: string, exchanges: ConversationExchange[]): SummaryCoverage {
  return {
    bytes: fs.statSync(archiveJsonlPath).size,
    lastExchange: exchanges[exchanges.length - 1]?.timestamp,
    schema: COVERAGE_SCHEMA,
  };
}

/** Write a real summary with its coverage header. The single summary-write path. */
export function writeSummary(
  summaryPath: string,
  archiveJsonlPath: string,
  exchanges: ConversationExchange[],
  body: string,
): void {
  fs.writeFileSync(summaryPath, formatSummaryFile(buildCoverage(archiveJsonlPath, exchanges), body), 'utf-8');
}

/**
 * Stamp a legacy (header-less) real summary with current coverage — a header
 * rewrite, NO LLM call — so existing summaries get a growth baseline without a
 * mass re-summarization on upgrade. No-op for missing/empty/errored/already-stamped files.
 */
export function ensureCoverageBaseline(summaryPath: string, archiveBytes: number): void {
  if (!fs.existsSync(summaryPath)) return;
  let content: string;
  try { content = fs.readFileSync(summaryPath, 'utf-8'); } catch { return; }
  if (content.length === 0 || isErroredSentinel(content)) return;
  const { coverage, body } = parseSummaryFile(content);
  if (coverage !== null) return;
  fs.writeFileSync(summaryPath, formatSummaryFile({ bytes: archiveBytes, schema: COVERAGE_SCHEMA }, body), 'utf-8');
}

/**
 * True when a conversation needs a (re-)summary. Stamps a coverage baseline on a
 * legacy header-less summary first, so future transcript growth stays detectable.
 */
export function needsSummary(summaryPath: string, archiveJsonlPath: string): boolean {
  const archiveBytes = fs.statSync(archiveJsonlPath).size;
  ensureCoverageBaseline(summaryPath, archiveBytes);
  return shouldQueueForSummary(summaryPath, archiveBytes);
}
