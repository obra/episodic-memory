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

export const COVERAGE_SCHEMA = 1;
const COVERAGE_PREFIX = '__COVERAGE__ ';

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

export function formatErrorSentinel(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${ERROR_MARKER}\n${new Date().toISOString()}\n${message}\n`;
}

export function isErroredSentinel(content: string): boolean {
  return content.startsWith(ERROR_MARKER_PREFIX);
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

function getErrorRetryMs(): number {
  return resolveHoursEnvMs('EPISODIC_MEMORY_SUMMARY_ERROR_RETRY_HOURS', DEFAULT_ERROR_RETRY_HOURS, false);
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

/**
 * Best-effort error sentinel, written only when no prior real summary exists so a
 * re-summary failure never discards good content. Swallows its own write errors.
 */
export function writeErrorSentinelIfNew(summaryPath: string, error: unknown): void {
  try {
    if (!hasRealSummary(summaryPath)) fs.writeFileSync(summaryPath, formatErrorSentinel(error), 'utf-8');
  } catch {}
}

/**
 * True when the conversation at `summaryPath` should be (re-)summarized:
 *  - no summary yet,
 *  - a stale error marker, or
 *  - a real summary whose covered byte size is below the current archive size
 *    (the transcript has grown — append-only, so a size increase means new content).
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
    try {
      const stat = fs.statSync(summaryPath);
      return Date.now() - stat.mtimeMs >= getErrorRetryMs();
    } catch {
      return false;
    }
  }
  const { coverage } = parseSummaryFile(content);
  if (coverage === null) return false; // legacy; caller must have stamped a baseline via ensureCoverageBaseline
  return currentArchiveBytes > coverage.bytes;
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
