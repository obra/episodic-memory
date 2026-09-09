import fs from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { SUMMARIZER_CONTEXT_MARKER } from './constants.js';
import { VERSION } from './version.js';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { codexVersionRequirementMessage, parseCodexCliVersion, versionMeetsMinimum, } from './codex-support.js';
/** Max chars of SDK `result` text kept on SummarizerSdkError (see #138). */
const SDK_ERROR_DETAIL_MAX = 300;
/**
 * Truncate SDK error detail for log/error/sentinel messages without dropping the lead.
 */
export function truncateSdkErrorDetail(detail, max = SDK_ERROR_DETAIL_MAX) {
    const collapsed = detail.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= max)
        return collapsed;
    return `${collapsed.slice(0, max - 1)}…`;
}
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
export class SummarizerSdkError extends Error {
    subtype;
    sessionId;
    apiErrorStatus;
    detail;
    constructor(subtype, sessionId, apiErrorStatus, detail) {
        const trimmed = typeof detail === 'string' ? detail.trim() : '';
        const kept = trimmed ? truncateSdkErrorDetail(trimmed) : undefined;
        super(`Summarizer SDK error: ${subtype}` +
            (apiErrorStatus != null ? ` (HTTP ${apiErrorStatus})` : '') +
            (sessionId ? ` (session ${sessionId})` : '') +
            (kept ? `: ${kept}` : ''));
        this.subtype = subtype;
        this.sessionId = sessionId;
        this.apiErrorStatus = apiErrorStatus;
        this.name = 'SummarizerSdkError';
        this.detail = kept;
    }
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
export function isResumeFailure(error) {
    if (!(error instanceof SummarizerSdkError))
        return false;
    if (error.subtype === 'error_during_execution')
        return true;
    if (error.apiErrorStatus === 400)
        return true;
    if (error.subtype === 'success' && /no conversation found/i.test(error.detail ?? ''))
        return true;
    return false;
}
/**
 * True when the SDK's spawned Claude Code subprocess died before returning a
 * result (e.g. `--resume` exiting nonzero because the session is a background
 * agent that can't be resumed without --fork-session; #146). The SDK throws
 * these as plain Errors, not SummarizerSdkError, so isResumeFailure never
 * matches them — callers that resumed a session should still fall back to the
 * non-resume path.
 */
export function isProcessExitFailure(error) {
    return error instanceof Error && /exited with code|terminated by signal/.test(error.message);
}
/**
 * True when a summarizer failure looks like a GLOBAL auth problem (expired
 * Claude CLI OAuth, 401, authentication_error). Auth is not per-conversation,
 * so sync fail-fasts the rest of the summary batch instead of burning minutes
 * re-billing doomed calls (#138). Matches against subtype + detail + message so
 * it works whether the SDK reported subtype 'success' with a 401 in `result` or
 * threw a plain Error.
 */
export function isAuthFailure(error) {
    const chunks = [];
    if (error instanceof SummarizerSdkError) {
        chunks.push(error.subtype, error.detail ?? '', error.message);
    }
    else if (error instanceof Error) {
        chunks.push(error.message);
    }
    else if (error != null) {
        chunks.push(String(error));
    }
    const text = chunks.join(' ').toLowerCase();
    if (!text.trim())
        return false;
    return (text.includes('failed to authenticate') ||
        text.includes('authentication_error') ||
        text.includes('oauth access token') ||
        text.includes('unauthorized') ||
        /\b401\b/.test(text));
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
export function getApiEnv() {
    const baseUrl = process.env.EPISODIC_MEMORY_API_BASE_URL;
    const token = process.env.EPISODIC_MEMORY_API_TOKEN;
    const timeoutMs = process.env.EPISODIC_MEMORY_API_TIMEOUT_MS;
    // Always include the reentrancy guard so the SDK-spawned Claude subprocess
    // (which inherits this env) marks itself as a reentrant context. The
    // SessionStart hook checks the guard via shouldSkipReentrantSync() and
    // exits before launching another sync, breaking the recursive cascade
    // reported in #87.
    //
    // The `...process.env` spread below also carries CLAUDE_CODE_USE_BEDROCK and
    // AWS_* (region, credentials, AWS_PROFILE, AWS_BEARER_TOKEN_BEDROCK) through
    // to the SDK subprocess unchanged, which is how summarization gets routed
    // through AWS Bedrock (#44). No per-var handling needed here — the spread
    // already covers it.
    return {
        ...process.env,
        EPISODIC_MEMORY_SUMMARIZER_GUARD: '1',
        ...(baseUrl && { ANTHROPIC_BASE_URL: baseUrl }),
        ...(token && { ANTHROPIC_AUTH_TOKEN: token }),
        ...(timeoutMs && { API_TIMEOUT_MS: timeoutMs }),
    };
}
/**
 * Detect whether the current process is running inside the Claude Agent SDK
 * subprocess that the summarizer just spawned. The flag is set by getApiEnv()
 * and inherited by the spawned subprocess. Used by sync entry points to bail
 * out before re-entering the sync→summarizer→spawn cycle (#87).
 */
export function shouldSkipReentrantSync() {
    return process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD === '1';
}
/** Default wall-clock ceiling for a single Claude summarizer query (#160). */
const DEFAULT_SUMMARY_TIMEOUT_MS = 120000; // matches Codex appServerTimeoutMs
/**
 * Wall-clock ceiling for a single Claude summarizer query(). A wedged subprocess
 * otherwise stalls forever while holding the sync single-instance lock, blocking
 * every later sync (#160). Override with EPISODIC_MEMORY_SUMMARY_TIMEOUT_MS.
 */
export function summaryTimeoutMs() {
    const configured = Number(process.env.EPISODIC_MEMORY_SUMMARY_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SUMMARY_TIMEOUT_MS;
}
/**
 * Thrown when a Claude summarizer query exceeds summaryTimeoutMs(). Deliberately
 * NOT matched by isResumeFailure/isProcessExitFailure, so a timeout surfaces as a
 * failure sentinel and is not retried in a loop (#160).
 */
export class SummarizerTimeoutError extends Error {
    timeoutMs;
    constructor(timeoutMs) {
        super(`Summarizer query timed out after ${timeoutMs}ms`);
        this.timeoutMs = timeoutMs;
        this.name = 'SummarizerTimeoutError';
    }
}
/**
 * True when the summarizer would spend real money: a metered Anthropic API key
 * is present in the environment (getApiEnv() spreads process.env, so the SDK
 * subprocess inherits it) AND the user has NOT pointed episodic-memory at its own
 * endpoint. Subscription (OAuth) auth carries no ANTHROPIC_API_KEY, so the key's
 * absence means "not metered" (#104).
 */
export function wouldBillMeteredApi() {
    if (process.env.EPISODIC_MEMORY_API_BASE_URL || process.env.EPISODIC_MEMORY_API_TOKEN) {
        return false;
    }
    return Boolean(process.env.ANTHROPIC_API_KEY);
}
/** Explicit user opt-in to metered billing (#104). */
export function meteredApiOptIn() {
    return process.env.EPISODIC_MEMORY_ALLOW_METERED_API === '1';
}
let meteredApiWarned = false;
/** Test-only: reset the once-per-process metered-API warning latch. */
export function resetMeteredApiWarningForTests() {
    meteredApiWarned = false;
}
/**
 * Warn once per process when background summarization will bill the metered
 * Anthropic API instead of a Claude subscription (#104). Summarization still
 * proceeds; the warning just makes the spend visible. EPISODIC_MEMORY_ALLOW_METERED_API=1
 * acknowledges it and silences the warning.
 */
export function warnMeteredApiOnce() {
    if (meteredApiWarned)
        return;
    meteredApiWarned = true;
    console.warn('episodic-memory: ANTHROPIC_API_KEY is set, so background summarization will ' +
        'bill the metered Anthropic API rather than your Claude subscription. ' +
        'Set EPISODIC_MEMORY_ALLOW_METERED_API=1 to acknowledge and silence this warning, ' +
        'unset ANTHROPIC_API_KEY to use your subscription, or set ' +
        'EPISODIC_MEMORY_API_BASE_URL / EPISODIC_MEMORY_API_TOKEN to route elsewhere.');
}
/**
 * Run one summarizer query() under a wall-clock timeout, returning the SDK's
 * `result` string. Throws SummarizerSdkError on an is_error result (carrying
 * api_error_status + truncated result text) and SummarizerTimeoutError if the
 * generator does not produce a result within timeoutMs — aborting the query via
 * AbortController and closing the generator so the wedged subprocess is torn down
 * (#160). Buffers the subprocess stderr and appends it to process-exit errors so
 * sentinels record the real cause (#147).
 */
export async function runSummarizerQuery(queryFn, prompt, options, timeoutMs) {
    const abortController = new AbortController();
    let stderrTail = '';
    const withGuards = {
        ...options,
        abortController,
        stderr: (data) => { stderrTail = (stderrTail + data).slice(-2000); },
    };
    const iterator = queryFn({ prompt, options: withGuards })[Symbol.asyncIterator]();
    let timedOut = false;
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            timedOut = true;
            try {
                abortController.abort();
            }
            catch { }
            reject(new SummarizerTimeoutError(timeoutMs));
        }, timeoutMs);
        // Don't let the summary timer alone keep the process alive.
        if (typeof timer.unref === 'function')
            timer.unref();
    });
    try {
        while (true) {
            const step = await Promise.race([iterator.next(), timeout]);
            if (step.done)
                break;
            const message = step.value;
            if (message && typeof message === 'object' && 'type' in message && message.type === 'result') {
                const result = message.result;
                // Throw on is_error, carrying HTTP status + result text so logs are diagnostic
                // and summarizeConversation can route a 400 / no-conversation to the transcript fallback.
                if (message.is_error) {
                    throw new SummarizerSdkError(message.subtype || 'unknown', message.session_id, message.api_error_status, typeof result === 'string' ? result : undefined);
                }
                return typeof result === 'string' ? result : '';
            }
        }
        return '';
    }
    catch (error) {
        if (!timedOut && error instanceof Error && stderrTail.trim() && isProcessExitFailure(error)) {
            error.message = `${error.message}: ${stderrTail.trim()}`;
        }
        throw error;
    }
    finally {
        if (timer)
            clearTimeout(timer);
        try {
            await iterator.return?.(undefined);
        }
        catch { }
    }
}
export function formatConversationText(exchanges) {
    return exchanges.map(ex => {
        return `User: ${ex.userMessage}\n\nAgent: ${ex.assistantMessage}`;
    }).join('\n\n---\n\n');
}
function extractSummary(text) {
    const match = text.match(/<summary>(.*?)<\/summary>/s);
    if (match) {
        return match[1].trim();
    }
    // Fallback if no tags found
    return text.trim();
}
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
export function buildSummarizerQueryOptions(args) {
    const { model, sessionId, cwd } = args;
    return {
        model,
        max_tokens: 4096,
        env: getApiEnv(),
        resume: sessionId,
        persistSession: false,
        // Summarizers never call tools — disabling them stops a resumed live
        // session from executing the session's pending work in the user's repo
        // (#116/#134). Empty tool list = no built-in tools available.
        tools: [],
        // Summarizers never call tools, so skip the user's MCP config entirely.
        // Without this, every summarization subprocess launches all configured MCP
        // servers; with concurrent summarizations that fans out to hundreds of
        // processes on MCP-heavy installs (#106).
        strictMcpConfig: true,
        // strictMcpConfig only blocks ~/.claude.json MCP servers; user settings
        // still load every enabled plugin (each with its own MCP server) plus the
        // user's Stop/Notification hooks (#136) into the subprocess. Summarizers
        // need no plugins, hooks, or user settings at all.
        settingSources: [],
        // Resume looks up the session under ~/.claude/projects/<encoded-cwd>/, so pass the recorded cwd when it still exists on disk.
        ...(cwd && fs.existsSync(cwd) ? { cwd } : {}),
        // Don't override systemPrompt when resuming — the resumed session's prompt stays in effect.
        ...(sessionId ? {} : {
            systemPrompt: 'Write concise, factual summaries. Output ONLY the summary - no preamble, no "Here is", no "I will". Your output will be indexed directly.'
        }),
    };
}
export function buildCodexSummaryPrompt() {
    return `${SUMMARIZER_CONTEXT_MARKER}.

You are running in an ephemeral Codex fork of an existing session. Use the forked session context, including available reasoning summaries and thinking context, to write a concise, factual summary of the conversation.

Do not inspect files, run commands, search the web, or modify state. Use only the conversation context already available in this forked session.

Output ONLY a <summary></summary> block. Summarize what happened in 2-4 sentences.

Include:
- What was built/changed/discussed (be specific)
- Key technical decisions or approaches
- Problems solved or current state

Exclude:
- Apologies, meta-commentary, or your questions
- Raw logs or debug output
- Generic descriptions - focus on what makes THIS conversation unique

Good:
<summary>Built JWT authentication for React app with refresh tokens and protected routes. Fixed token expiration bug by implementing refresh-during-request logic.</summary>

Bad:
<summary>I apologize. The conversation discussed authentication and various approaches were considered...</summary>`;
}
export function buildCodexSummarizerCommand(args) {
    const command = args.codexBin || process.env.EPISODIC_MEMORY_CODEX_BIN || 'codex';
    return {
        command,
        args: ['app-server'],
        prompt: args.prompt,
        sessionId: args.sessionId,
        model: args.model,
    };
}
async function callClaude(prompt, sessionId, useFallback = false, cwd) {
    const primaryModel = process.env.EPISODIC_MEMORY_API_MODEL || 'haiku';
    const fallbackModel = process.env.EPISODIC_MEMORY_API_MODEL_FALLBACK || 'sonnet';
    const model = useFallback ? fallbackModel : primaryModel;
    const options = buildSummarizerQueryOptions({ model, sessionId, cwd });
    const result = await runSummarizerQuery(query, prompt, options, summaryTimeoutMs());
    // Check if result is an API error the SDK returns as a result string (not is_error).
    if (typeof result === 'string' && result.includes('API Error') && result.includes('thinking.budget_tokens')) {
        if (!useFallback) {
            console.log(`    ${primaryModel} hit thinking budget error, retrying with ${fallbackModel}`);
            return await callClaude(prompt, sessionId, true, cwd);
        }
        // If fallback also fails, return error message
        return result;
    }
    return result;
}
function appServerTimeoutMs() {
    const configured = Number(process.env.EPISODIC_MEMORY_CODEX_SUMMARY_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : 120000;
}
function readCommandOutput(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            env: getApiEnv(),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        child.stdout.on('data', chunk => {
            output += chunk.toString();
        });
        child.stderr.on('data', chunk => {
            output += chunk.toString();
        });
        child.on('error', reject);
        child.on('exit', code => {
            if (code === 0) {
                resolve(output);
            }
            else {
                reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}: ${output.trim()}`));
            }
        });
    });
}
async function assertSupportedCodexVersion(command) {
    if (command.skipVersionCheck) {
        return;
    }
    const output = await readCommandOutput(command.command, command.versionArgs || ['--version']);
    const version = parseCodexCliVersion(output);
    if (!version || !versionMeetsMinimum(version)) {
        throw new Error(codexVersionRequirementMessage(output));
    }
}
function requireThreadId(result, method) {
    const threadId = result?.thread?.id;
    if (typeof threadId !== 'string' || !threadId) {
        throw new Error(`${method} returned unexpected response: ${JSON.stringify(result)}`);
    }
    return threadId;
}
function requireTurnId(result, method) {
    const turnId = result?.turn?.id;
    if (typeof turnId !== 'string' || !turnId) {
        throw new Error(`${method} returned unexpected response: ${JSON.stringify(result)}`);
    }
    return turnId;
}
export async function runCodexCommand(command) {
    await assertSupportedCodexVersion(command);
    return new Promise((resolve, reject) => {
        const child = spawn(command.command, command.args, {
            env: getApiEnv(),
            stdio: ['pipe', 'pipe', 'pipe']
        });
        let stderr = '';
        let answer = '';
        let nextRequestId = 1;
        let targetTurnId;
        let finished = false;
        let timeout;
        const pending = new Map();
        const lines = createInterface({ input: child.stdout });
        child.stderr.on('data', chunk => {
            stderr += chunk.toString();
        });
        const cleanup = () => {
            if (timeout) {
                clearTimeout(timeout);
            }
            lines.close();
            if (!child.killed) {
                child.kill('SIGTERM');
            }
        };
        const finish = (error, result = '') => {
            if (finished)
                return;
            finished = true;
            cleanup();
            if (error) {
                reject(error);
            }
            else {
                resolve(result);
            }
        };
        timeout = setTimeout(() => {
            finish(new Error(`Codex summarizer timed out after ${appServerTimeoutMs()}ms: ${stderr.trim()}`));
        }, appServerTimeoutMs());
        const send = (method, params) => {
            const id = nextRequestId++;
            child.stdin.write(JSON.stringify({ method, id, params }) + '\n');
            return new Promise((resolveRequest, rejectRequest) => {
                pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest });
            });
        };
        const notify = (method, params) => {
            const message = params === undefined ? { method } : { method, params };
            child.stdin.write(JSON.stringify(message) + '\n');
        };
        lines.on('line', line => {
            if (!line.trim())
                return;
            let message;
            try {
                message = JSON.parse(line);
            }
            catch (error) {
                finish(new Error(`Codex app-server emitted invalid JSON: ${line}`));
                return;
            }
            if (typeof message.id === 'number' && pending.has(message.id)) {
                const request = pending.get(message.id);
                pending.delete(message.id);
                if (message.error) {
                    request.reject(new Error(`${request.method} failed: ${JSON.stringify(message.error)}`));
                }
                else {
                    request.resolve(message.result);
                }
                return;
            }
            if (message.method === 'item/agentMessage/delta') {
                answer += message.params?.delta ?? '';
                return;
            }
            if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage') {
                answer = message.params.item.text ?? answer;
                return;
            }
            if (message.method === 'turn/completed' &&
                (!targetTurnId || message.params?.turn?.id === targetTurnId)) {
                if (message.params.turn.status === 'completed') {
                    finish(undefined, answer);
                }
                else {
                    const detail = message.params.turn.error?.message || message.params.turn.status;
                    finish(new Error(`Codex summarizer turn did not complete: ${detail}`));
                }
            }
        });
        child.on('error', error => {
            finish(error);
        });
        child.on('exit', code => {
            if (!finished) {
                const detail = code === 0
                    ? 'Codex app-server exited before the summary turn completed'
                    : `Codex summarizer failed with exit code ${code}: ${stderr.trim()}`;
                finish(new Error(detail));
            }
        });
        (async () => {
            try {
                await send('initialize', {
                    clientInfo: {
                        name: 'episodic-memory',
                        title: 'Episodic Memory',
                        version: VERSION,
                    },
                    capabilities: {
                        experimentalApi: true,
                    },
                });
                notify('initialized');
                const fork = await send('thread/fork', {
                    threadId: command.sessionId,
                    ephemeral: true,
                    excludeTurns: true,
                    sandbox: 'read-only',
                    approvalPolicy: 'never',
                    ...(command.model ? { model: command.model } : {}),
                });
                const forkThreadId = requireThreadId(fork, 'thread/fork');
                const turn = await send('turn/start', {
                    threadId: forkThreadId,
                    input: [{
                            type: 'text',
                            text: command.prompt,
                            textElements: [],
                        }],
                });
                targetTurnId = requireTurnId(turn, 'turn/start');
            }
            catch (error) {
                finish(error instanceof Error ? error : new Error(String(error)));
            }
        })();
    });
}
async function callCodex(prompt, sessionId, model) {
    const command = buildCodexSummarizerCommand({ sessionId, prompt, model });
    return runCodexCommand(command);
}
function chunkExchanges(exchanges, chunkSize) {
    const chunks = [];
    for (let i = 0; i < exchanges.length; i += chunkSize) {
        chunks.push(exchanges.slice(i, i + chunkSize));
    }
    return chunks;
}
function getCodexSessionId(exchanges, sessionId) {
    if (!exchanges.some(exchange => exchange.harness === 'codex')) {
        return undefined;
    }
    return sessionId || exchanges.find(exchange => exchange.sessionId)?.sessionId;
}
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
export function getCodexModel(_exchanges) {
    return process.env.EPISODIC_MEMORY_CODEX_MODEL || undefined;
}
export async function summarizeConversation(exchanges, sessionId) {
    // Handle trivial conversations
    if (exchanges.length === 0) {
        return 'Trivial conversation with no substantive content.';
    }
    if (exchanges.length === 1) {
        const text = formatConversationText(exchanges);
        if (text.length < 100 || exchanges[0].userMessage.trim() === '/exit') {
            return 'Trivial conversation with no substantive content.';
        }
    }
    const codexSessionId = getCodexSessionId(exchanges, sessionId);
    if (codexSessionId) {
        try {
            const result = await callCodex(buildCodexSummaryPrompt(), codexSessionId, getCodexModel(exchanges));
            return extractSummary(result);
        }
        catch (error) {
            console.log(`  Codex summarizer unavailable, falling back to transcript text: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // Cost safety (#104): everything below this point calls the metered Claude API
    // path. If a stray global ANTHROPIC_API_KEY would be billed and the user hasn't
    // acknowledged it, warn once and proceed (don't silently spend without notice).
    // Placed AFTER the Codex attempt so pure-Codex users are never warned needlessly.
    if (wouldBillMeteredApi() && !meteredApiOptIn()) {
        warnMeteredApiOnce();
    }
    // For short conversations (≤15 exchanges), summarize directly
    if (exchanges.length <= 15) {
        // Only Claude Code sessions can be resumed by `claude --resume`; Cursor
        // sessions carry composer UUIDs Claude Code doesn't know, so resuming
        // would fail on every one before the no-resume retry kicks in. Treat
        // missing harness as Claude for backward compatibility with old archives.
        const isClaudeSession = exchanges.some(e => e.harness === 'claude' || e.harness === undefined);
        const claudeSessionId = !codexSessionId && isClaudeSession ? sessionId : undefined;
        const cwd = claudeSessionId ? exchanges.find(e => e.cwd)?.cwd : undefined;
        const conversationText = claudeSessionId
            ? '' // When resuming, no need to include conversation text - it's already in context
            : formatConversationText(exchanges);
        const prompt = `${SUMMARIZER_CONTEXT_MARKER}.

Please write a concise, factual summary of this conversation. Output ONLY the summary - no preamble. Claude will see this summary when searching previous conversations for useful memories and information.

Summarize what happened in 2-4 sentences. Be factual and specific. Output in <summary></summary> tags.

Include:
- What was built/changed/discussed (be specific)
- Key technical decisions or approaches
- Problems solved or current state

Exclude:
- Apologies, meta-commentary, or your questions
- Raw logs or debug output
- Generic descriptions - focus on what makes THIS conversation unique

Good:
<summary>Built JWT authentication for React app with refresh tokens and protected routes. Fixed token expiration bug by implementing refresh-during-request logic.</summary>

Bad:
<summary>I apologize. The conversation discussed authentication and various approaches were considered...</summary>

${conversationText}`;
        try {
            const result = await callClaude(prompt, claudeSessionId, false, cwd);
            return extractSummary(result);
        }
        catch (error) {
            // Resume can fail for several reasons the transcript path doesn't care
            // about: the recorded cwd is gone (error_during_execution), the API
            // rejected the replayed thinking blocks (HTTP 400), the session is
            // archive-only ("No conversation found", subtype 'success'; #122), or the
            // subprocess refused to resume and exited nonzero (bg-agent sessions; #146).
            // Any of those → retry once without resume, feeding the transcript as text.
            // Genuine auth failures are global, not resume-specific, so they fail-fast
            // (never fall back). A timeout is neither, so it also propagates.
            if (claudeSessionId &&
                (isResumeFailure(error) || isProcessExitFailure(error)) &&
                !isAuthFailure(error)) {
                console.log(`    resume failed for ${claudeSessionId} (${error.message}); retrying without resume`);
                const fullPrompt = prompt + '\n\n' + formatConversationText(exchanges);
                const result = await callClaude(fullPrompt);
                return extractSummary(result);
            }
            throw error;
        }
    }
    // For long conversations, use hierarchical summarization
    console.log(`  Long conversation (${exchanges.length} exchanges) - using hierarchical summarization`);
    // Note: Hierarchical summarization doesn't support resume mode (needs fresh session for each chunk)
    // This is fine since we only use resume for the main session-end hook
    // Chunk into groups of 8 exchanges
    const chunks = chunkExchanges(exchanges, 8);
    console.log(`  Split into ${chunks.length} chunks`);
    // Summarize each chunk
    const chunkSummaries = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunkText = formatConversationText(chunks[i]);
        const prompt = `${SUMMARIZER_CONTEXT_MARKER}.

Please write a concise summary of this part of a conversation in 2-3 sentences. What happened, what was built/discussed. Use <summary></summary> tags.

${chunkText}

Example: <summary>Implemented HID keyboard functionality for ESP32. Hit Bluetooth controller initialization error, fixed by adjusting memory allocation.</summary>`;
        try {
            const summary = await callClaude(prompt); // No sessionId for chunks
            const extracted = extractSummary(summary);
            chunkSummaries.push(extracted);
            console.log(`  Chunk ${i + 1}/${chunks.length}: ${extracted.split(/\s+/).length} words`);
        }
        catch (error) {
            console.log(`  Chunk ${i + 1} failed, skipping`);
        }
    }
    if (chunkSummaries.length === 0) {
        return 'Error: Unable to summarize conversation.';
    }
    // Synthesize chunks into final summary
    const synthesisPrompt = `${SUMMARIZER_CONTEXT_MARKER}.

Please write a concise, factual summary that synthesizes these part-summaries into one cohesive paragraph. Focus on what was accomplished and any notable technical decisions or challenges. Output in <summary></summary> tags. Claude will see this summary when searching previous conversations for useful memories and information.

Part summaries:
${chunkSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Good:
<summary>Built conversation search system with JavaScript, sqlite-vec, and local embeddings. Implemented hierarchical summarization for long conversations. System archives conversations permanently and provides semantic search via CLI.</summary>

Bad:
<summary>This conversation synthesizes several topics discussed across multiple parts...</summary>

Your summary (max 200 words):`;
    console.log(`  Synthesizing final summary...`);
    try {
        const result = await callClaude(synthesisPrompt); // No sessionId for synthesis
        return extractSummary(result);
    }
    catch (error) {
        console.log(`  Synthesis failed, using chunk summaries`);
        return chunkSummaries.join(' ');
    }
}
