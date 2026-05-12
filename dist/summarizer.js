import { query } from '@anthropic-ai/claude-agent-sdk';
import { SUMMARIZER_CONTEXT_MARKER } from './constants.js';
import { VERSION } from './version.js';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
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
 */
export function buildSummarizerQueryOptions(args) {
    const { model, sessionId } = args;
    return {
        model,
        max_tokens: 4096,
        env: getApiEnv(),
        resume: sessionId,
        persistSession: false,
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
async function callClaude(prompt, sessionId, useFallback = false) {
    const primaryModel = process.env.EPISODIC_MEMORY_API_MODEL || 'haiku';
    const fallbackModel = process.env.EPISODIC_MEMORY_API_MODEL_FALLBACK || 'sonnet';
    const model = useFallback ? fallbackModel : primaryModel;
    for await (const message of query({
        prompt,
        options: buildSummarizerQueryOptions({ model, sessionId }),
    })) {
        if (message && typeof message === 'object' && 'type' in message && message.type === 'result') {
            const result = message.result;
            // Check if result is an API error (SDK returns errors as result strings)
            if (typeof result === 'string' && result.includes('API Error') && result.includes('thinking.budget_tokens')) {
                if (!useFallback) {
                    console.log(`    ${primaryModel} hit thinking budget error, retrying with ${fallbackModel}`);
                    return await callClaude(prompt, sessionId, true);
                }
                // If fallback also fails, return error message
                return result;
            }
            return result;
        }
    }
    return '';
}
function appServerTimeoutMs() {
    const configured = Number(process.env.EPISODIC_MEMORY_CODEX_SUMMARY_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : 120000;
}
export async function runCodexCommand(command) {
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
            if (message.method === 'turn/completed' && message.params?.turn?.id === targetTurnId) {
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
                    sandbox: 'read-only',
                    approvalPolicy: 'never',
                    ...(command.model ? { model: command.model } : {}),
                });
                const turn = await send('turn/start', {
                    threadId: fork.thread.id,
                    input: [{
                            type: 'text',
                            text: command.prompt,
                            textElements: [],
                        }],
                });
                targetTurnId = turn.turn.id;
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
function getCodexModel(exchanges) {
    return exchanges.find(exchange => exchange.harness === 'codex' && exchange.model)?.model;
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
        const result = await callCodex(buildCodexSummaryPrompt(), codexSessionId, getCodexModel(exchanges));
        return extractSummary(result);
    }
    // For short conversations (≤15 exchanges), summarize directly
    if (exchanges.length <= 15) {
        const conversationText = sessionId
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
        const result = await callClaude(prompt, sessionId);
        return extractSummary(result);
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
