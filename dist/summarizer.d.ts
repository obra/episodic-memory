import { ConversationExchange } from './types.js';
/**
 * Truncate SDK error detail for log/error/sentinel messages without dropping the lead.
 */
export declare function truncateSdkErrorDetail(detail: string, max?: number): string;
/**
 * Thrown by the summarizer query when the SDK yields an `is_error: true` result.
 * Carries `subtype`, `session_id`, `api_error_status`, and the (truncated) SDK
 * `result` text so callers can dispatch on structure and logs/sentinels show the
 * real failure — not a bare, often-useless subtype. The SDK pairs
 * `subtype: 'success'` with `is_error: true` when the loop finished but the turn
 * hit an API error (carried in `result` / `api_error_status`): e.g. a CLI OAuth
 * 401 (#138), a replayed-thinking-block 400 (#110), or "No conversation found"
 * on an archive-only resume (#122).
 */
export declare class SummarizerSdkError extends Error {
    readonly subtype: string;
    readonly sessionId?: string | undefined;
    readonly apiErrorStatus?: number | null | undefined;
    readonly detail?: string;
    constructor(subtype: string, sessionId?: string | undefined, apiErrorStatus?: number | null | undefined, detail?: string);
}
/**
 * True when the resume continuation itself failed — the trigger for the
 * non-resume (transcript-text) fallback in summarizeConversation. Signals:
 * - `error_during_execution`: the SDK couldn't resume (e.g. recorded cwd gone).
 * - HTTP 400: the API rejected the replayed history — canonically the `thinking`
 *   blocks it forbids modifying on continuation (#110). Our prompt is plain
 *   text, so a 400 on resume can only come from the replayed turns.
 * - `subtype: 'success'` with a "No conversation found" detail: an archive-only
 *   session the CLI can't resume (#122). The SDK reports this with is_error but
 *   subtype 'success', so the bare-subtype check missed it and the fallback
 *   never fired.
 * Auth failures also use subtype 'success' — those are NOT resume-specific and
 * are excluded here (401/429/529 return false); isAuthFailure handles them.
 */
export declare function isResumeFailure(error: unknown): boolean;
/**
 * True when the SDK's spawned Claude Code subprocess died before returning a
 * result (e.g. `--resume` exiting nonzero because the session is a background
 * agent that can't be resumed without --fork-session; #146). The SDK throws
 * these as plain Errors, not SummarizerSdkError, so isResumeFailure never
 * matches them — callers that resumed a session should still fall back to the
 * non-resume path.
 */
export declare function isProcessExitFailure(error: unknown): boolean;
/**
 * True when a summarizer failure looks like a GLOBAL auth problem (expired
 * Claude CLI OAuth, 401, authentication_error). Auth is not per-conversation,
 * so sync fail-fasts the rest of the summary batch instead of burning minutes
 * re-billing doomed calls (#138). Matches against subtype + detail + message so
 * it works whether the SDK reported subtype 'success' with a 401 in `result` or
 * threw a plain Error.
 */
export declare function isAuthFailure(error: unknown): boolean;
export interface CodexSummarizerCommand {
    command: string;
    args: string[];
    prompt: string;
    sessionId: string;
    model?: string;
    versionArgs?: string[];
    skipVersionCheck?: boolean;
}
/**
 * Get API environment overrides for summarization calls.
 * Returns full env merged with process.env so subprocess inherits PATH, HOME, etc.
 *
 * Env vars (all optional):
 * - EPISODIC_MEMORY_API_MODEL: Model to use (default: haiku)
 * - EPISODIC_MEMORY_API_MODEL_FALLBACK: Fallback model on error (default: sonnet)
 * - EPISODIC_MEMORY_API_BASE_URL: Custom API endpoint
 * - EPISODIC_MEMORY_API_TOKEN: Auth token for custom endpoint
 * - EPISODIC_MEMORY_API_TIMEOUT_MS: Timeout for API calls (default: SDK default)
 */
export declare function getApiEnv(): Record<string, string | undefined> | undefined;
/**
 * Detect whether the current process is running inside the Claude Agent SDK
 * subprocess that the summarizer just spawned. The flag is set by getApiEnv()
 * and inherited by the spawned subprocess. Used by sync entry points to bail
 * out before re-entering the sync→summarizer→spawn cycle (#87).
 */
export declare function shouldSkipReentrantSync(): boolean;
/**
 * Wall-clock ceiling for a single Claude summarizer query(). A wedged subprocess
 * otherwise stalls forever while holding the sync single-instance lock, blocking
 * every later sync (#160). Override with EPISODIC_MEMORY_SUMMARY_TIMEOUT_MS.
 */
export declare function summaryTimeoutMs(): number;
/**
 * Thrown when a Claude summarizer query exceeds summaryTimeoutMs(). Deliberately
 * NOT matched by isResumeFailure/isProcessExitFailure, so a timeout surfaces as a
 * failure sentinel and is not retried in a loop (#160).
 */
export declare class SummarizerTimeoutError extends Error {
    readonly timeoutMs: number;
    constructor(timeoutMs: number);
}
/**
 * True when the summarizer would spend real money: a metered Anthropic API key
 * is present in the environment (getApiEnv() spreads process.env, so the SDK
 * subprocess inherits it) AND the user has NOT pointed episodic-memory at its own
 * endpoint. Subscription (OAuth) auth carries no ANTHROPIC_API_KEY, so the key's
 * absence means "not metered" (#104).
 */
export declare function wouldBillMeteredApi(): boolean;
/** Explicit user opt-in to metered billing (#104). */
export declare function meteredApiOptIn(): boolean;
/** Test-only: reset the once-per-process metered-API warning latch. */
export declare function resetMeteredApiWarningForTests(): void;
/**
 * Warn once per process when background summarization will bill the metered
 * Anthropic API instead of a Claude subscription (#104). Summarization still
 * proceeds; the warning just makes the spend visible. EPISODIC_MEMORY_ALLOW_METERED_API=1
 * acknowledges it and silences the warning.
 */
export declare function warnMeteredApiOnce(): void;
/** The subset of the SDK query() signature the summarizer depends on. Injectable for tests. */
export type SummarizerQueryFn = (args: {
    prompt: string;
    options: Record<string, unknown>;
}) => AsyncIterable<unknown>;
/**
 * Run one summarizer query() under a wall-clock timeout, returning the SDK's
 * `result` string. Throws SummarizerSdkError on an is_error result (carrying
 * api_error_status + truncated result text) and SummarizerTimeoutError if the
 * generator does not produce a result within timeoutMs — aborting the query via
 * AbortController and closing the generator so the wedged subprocess is torn down
 * (#160). Buffers the subprocess stderr and appends it to process-exit errors so
 * sentinels record the real cause (#147).
 */
export declare function runSummarizerQuery(queryFn: SummarizerQueryFn, prompt: string, options: Record<string, unknown>, timeoutMs: number): Promise<string>;
export declare function formatConversationText(exchanges: ConversationExchange[]): string;
/**
 * Build the options object passed to the Claude Agent SDK's query() for a
 * summarization call.
 *
 * persistSession: false keeps the SDK from writing its session transcript to
 * ~/.claude/projects/ (#83). Without it, every summarization spawns a fake
 * session JSONL that pollutes the IDE session sidebar. The option is honored
 * by claude-agent-sdk >= 0.2.0.
 *
 * tools: [] disables every built-in tool so a resumed mid-task session can't
 * keep EXECUTING the task instead of writing a <summary>.
 */
export declare function buildSummarizerQueryOptions(args: {
    model: string;
    sessionId?: string;
    cwd?: string;
}): Record<string, unknown>;
export declare function buildCodexSummaryPrompt(): string;
export declare function buildCodexSummarizerCommand(args: {
    sessionId: string;
    prompt: string;
    model?: string;
    codexBin?: string;
}): CodexSummarizerCommand;
export declare function runCodexCommand(command: CodexSummarizerCommand): Promise<string>;
/**
 * Resolve the model to pass into Codex `thread/fork` for summarization.
 *
 * Historical exchanges may carry deprecated model ids (e.g. `gpt-5.2-codex`),
 * and `-codex`-suffixed variants are API-key-only — ChatGPT-subscription users
 * get a 400 from `app-server` regardless of the suffix used. Reading the model
 * from history therefore breaks summarization for two large user populations.
 *
 * Default to `undefined` so `app-server` uses the current Codex config
 * (`~/.codex/config.toml#model`). Operators can override via
 * `EPISODIC_MEMORY_CODEX_MODEL` if they need a specific model id (e.g. an
 * API-key user wanting `gpt-5.5-codex`).
 *
 * See https://github.com/obra/episodic-memory/issues/98.
 */
export declare function getCodexModel(_exchanges: ConversationExchange[]): string | undefined;
export declare function summarizeConversation(exchanges: ConversationExchange[], sessionId?: string): Promise<string>;
