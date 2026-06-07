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
export declare const ERROR_MARKER = "__ERRORED__";
export declare const COVERAGE_SCHEMA = 1;
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
export declare function formatSummaryFile(coverage: SummaryCoverage, body: string): string;
/**
 * Split a summary file into its coverage header (if present) and body.
 * A header-less file is legacy: coverage is null and the whole content is body.
 * A present-but-corrupt header line is stripped (never leaked into the body).
 */
export declare function parseSummaryFile(content: string): {
    coverage: SummaryCoverage | null;
    body: string;
};
export declare function formatErrorSentinel(error: unknown): string;
export declare function isErroredSentinel(content: string): boolean;
/**
 * True when the sentinel at `summaryPath` represents a real summary —
 * a file with a non-empty summary body that is not an error marker. Empty
 * zero-exchange sentinels, header-only files (empty body), and error sentinels
 * all return false. Use this for callers that care about "is this conversation
 * summarized and useful" (stats, verify, search).
 */
export declare function hasRealSummary(summaryPath: string): boolean;
/**
 * Best-effort error sentinel, written only when no prior real summary exists so a
 * re-summary failure never discards good content. Swallows its own write errors.
 */
export declare function writeErrorSentinelIfNew(summaryPath: string, error: unknown): void;
/**
 * True when the conversation at `summaryPath` should be (re-)summarized:
 *  - no summary yet,
 *  - a stale error marker, or
 *  - a real summary whose covered byte size is below the current archive size
 *    (the transcript has grown — append-only, so a size increase means new content).
 * A legacy header-less summary returns false; callers must call
 * ensureCoverageBaseline first so a baseline exists and future growth is detected.
 */
export declare function shouldQueueForSummary(summaryPath: string, currentArchiveBytes: number): boolean;
/** Idle time a conversation must reach before it is (re)summarized.
 *  Allows 0 (summarize immediately, e.g. in tests); rejects negative/garbage. */
export declare function getQuiescenceMs(): number;
/**
 * True when the conversation has been idle for at least the quiescence window.
 * Uses the last exchange's timestamp (file mtime is unreliable — the archive
 * copy's mtime is reset every sync). A missing/unparseable timestamp is treated
 * as quiescent so it never blocks summarization.
 */
export declare function isQuiescent(exchanges: ConversationExchange[], nowMs: number): boolean;
/** Coverage metadata for the conversation currently archived at `archiveJsonlPath`. */
export declare function buildCoverage(archiveJsonlPath: string, exchanges: ConversationExchange[]): SummaryCoverage;
/** Write a real summary with its coverage header. The single summary-write path. */
export declare function writeSummary(summaryPath: string, archiveJsonlPath: string, exchanges: ConversationExchange[], body: string): void;
/**
 * Stamp a legacy (header-less) real summary with current coverage — a header
 * rewrite, NO LLM call — so existing summaries get a growth baseline without a
 * mass re-summarization on upgrade. No-op for missing/empty/errored/already-stamped files.
 */
export declare function ensureCoverageBaseline(summaryPath: string, archiveBytes: number): void;
/**
 * True when a conversation needs a (re-)summary. Stamps a coverage baseline on a
 * legacy header-less summary first, so future transcript growth stays detectable.
 */
export declare function needsSummary(summaryPath: string, archiveJsonlPath: string): boolean;
