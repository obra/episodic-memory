import fs from 'fs';
import readline from 'readline';
import path from 'path';
import crypto from 'crypto';
async function detectConversationHarness(filePath) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    for await (const line of rl) {
        if (!line.trim())
            continue;
        try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'opencode_session' ||
                parsed.type === 'opencode_message') {
                return 'opencode';
            }
            if (parsed.payload &&
                (parsed.type === 'session_meta' ||
                    parsed.type === 'turn_context' ||
                    parsed.type === 'response_item' ||
                    parsed.type === 'event_msg' ||
                    parsed.type === 'compacted')) {
                return 'codex';
            }
            // Oh My Pi (OMP) pi-lineage transcripts open with a bare session header
            // ({type:"session", id, cwd}) with no payload/session sub-object (which
            // would be Codex/opencode), and their turns are {type:"message",
            // message:{role, content}} — a shape no other harness uses.
            const maybeOmp = parsed;
            if (parsed.type === 'session' && !parsed.payload && !maybeOmp.session) {
                return 'omp';
            }
            if (parsed.type === 'message' && maybeOmp.message && maybeOmp.message.role) {
                return 'omp';
            }
            // Cursor agent transcripts (~/.cursor/projects/<slug>/agent-transcripts/)
            // carry role+message with no top-level type field.
            const maybeCursor = parsed;
            if (parsed.type === undefined && maybeCursor.role && maybeCursor.message) {
                return 'cursor';
            }
            // Cursor transcripts also contain status/error noise lines; skip them
            // rather than misdetecting the file as a Claude conversation.
            if (parsed.type === 'status' || parsed.type === 'error') {
                continue;
            }
            return 'claude';
        }
        catch {
            continue;
        }
    }
    return 'claude';
}
export async function parseConversation(filePath, projectName, archivePath) {
    const harness = await detectConversationHarness(filePath);
    if (harness === 'codex') {
        return parseCodexConversation(filePath, projectName, archivePath);
    }
    if (harness === 'cursor') {
        return parseCursorConversation(filePath, projectName, archivePath);
    }
    if (harness === 'opencode') {
        return parseOpencodeConversation(filePath, projectName, archivePath);
    }
    if (harness === 'omp') {
        return parseOmpConversation(filePath, projectName, archivePath);
    }
    return parseClaudeConversation(filePath, projectName, archivePath);
}
async function parseClaudeConversation(filePath, projectName, archivePath) {
    const exchanges = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    let lineNumber = 0;
    let currentExchange = null;
    const finalizeExchange = () => {
        if (currentExchange && currentExchange.assistantMessages.length > 0) {
            const exchangeId = crypto
                .createHash('md5')
                .update(`${archivePath}:${currentExchange.userLine}-${currentExchange.lastAssistantLine}`)
                .digest('hex');
            // Update tool call exchange IDs
            const toolCalls = currentExchange.toolCalls.map(tc => ({
                ...tc,
                exchangeId
            }));
            const exchange = {
                id: exchangeId,
                project: currentExchange.project,
                timestamp: currentExchange.timestamp,
                userMessage: currentExchange.userMessage,
                assistantMessage: currentExchange.assistantMessages.join('\n\n'),
                archivePath,
                lineStart: currentExchange.userLine,
                lineEnd: currentExchange.lastAssistantLine,
                parentUuid: currentExchange.parentUuid,
                isSidechain: currentExchange.isSidechain,
                harness: currentExchange.harness,
                sessionId: currentExchange.sessionId,
                cwd: currentExchange.cwd,
                gitBranch: currentExchange.gitBranch,
                claudeVersion: currentExchange.claudeVersion,
                agentVersion: currentExchange.agentVersion,
                model: currentExchange.model,
                modelProvider: currentExchange.modelProvider,
                thinkingLevel: currentExchange.thinkingLevel,
                thinkingDisabled: currentExchange.thinkingDisabled,
                thinkingTriggers: currentExchange.thinkingTriggers,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined
            };
            exchanges.push(exchange);
        }
    };
    for await (const line of rl) {
        lineNumber++;
        try {
            const parsed = JSON.parse(line);
            // Skip non-message types
            if (parsed.type !== 'user' && parsed.type !== 'assistant') {
                continue;
            }
            if (!parsed.message) {
                continue;
            }
            // Extract text from message content
            let text = '';
            const toolCalls = [];
            if (typeof parsed.message.content === 'string') {
                text = parsed.message.content;
            }
            else if (Array.isArray(parsed.message.content)) {
                // Extract text blocks
                const textBlocks = parsed.message.content
                    .filter(block => block.type === 'text' && block.text)
                    .map(block => block.text);
                text = textBlocks.join('\n');
                // Extract tool use blocks
                if (parsed.message.role === 'assistant') {
                    for (const block of parsed.message.content) {
                        if (block.type === 'tool_use') {
                            const toolCallId = crypto.randomUUID();
                            toolCalls.push({
                                id: toolCallId,
                                exchangeId: '', // Will be set when we know the exchange ID
                                toolName: block.name || 'unknown',
                                toolInput: block.input,
                                isError: false,
                                timestamp: parsed.timestamp || new Date().toISOString()
                            });
                        }
                    }
                }
                // Extract tool results
                if (parsed.message.role === 'user') {
                    for (const block of parsed.message.content) {
                        if (block.type === 'tool_result') {
                            // Store for later association with tool_use
                            // For now, we'll just track results exist
                            // TODO: Match tool_use_id to previous tool_use
                        }
                    }
                }
            }
            // Skip empty messages
            if (!text.trim() && toolCalls.length === 0) {
                continue;
            }
            if (parsed.message.role === 'user') {
                // Finalize previous exchange before starting new one
                finalizeExchange();
                // Start new exchange
                currentExchange = {
                    project: projectName,
                    userMessage: text || '(tool results only)',
                    userLine: lineNumber,
                    assistantMessages: [],
                    lastAssistantLine: lineNumber,
                    timestamp: parsed.timestamp || new Date().toISOString(),
                    parentUuid: parsed.parentUuid,
                    isSidechain: parsed.isSidechain,
                    harness: 'claude',
                    sessionId: parsed.sessionId,
                    cwd: parsed.cwd,
                    gitBranch: parsed.gitBranch,
                    claudeVersion: parsed.version,
                    agentVersion: parsed.version,
                    model: parsed.message.model,
                    thinkingLevel: parsed.thinkingMetadata?.level,
                    thinkingDisabled: parsed.thinkingMetadata?.disabled,
                    thinkingTriggers: parsed.thinkingMetadata?.triggers ? JSON.stringify(parsed.thinkingMetadata.triggers) : undefined,
                    toolCalls: []
                };
            }
            else if (parsed.message.role === 'assistant' && currentExchange) {
                // Accumulate assistant messages
                if (text.trim()) {
                    currentExchange.assistantMessages.push(text);
                }
                currentExchange.lastAssistantLine = lineNumber;
                // Add tool calls to current exchange
                if (toolCalls.length > 0) {
                    currentExchange.toolCalls.push(...toolCalls);
                }
                // Update timestamp to last assistant message
                if (parsed.timestamp) {
                    currentExchange.timestamp = parsed.timestamp;
                }
                // Update metadata from assistant messages (use most recent)
                if (parsed.sessionId)
                    currentExchange.sessionId = parsed.sessionId;
                if (parsed.cwd)
                    currentExchange.cwd = parsed.cwd;
                if (parsed.gitBranch)
                    currentExchange.gitBranch = parsed.gitBranch;
                if (parsed.version) {
                    currentExchange.claudeVersion = parsed.version;
                    currentExchange.agentVersion = parsed.version;
                }
                if (parsed.message.model)
                    currentExchange.model = parsed.message.model;
            }
        }
        catch (error) {
            // Skip malformed JSON lines
            continue;
        }
    }
    // Finalize last exchange
    finalizeExchange();
    return exchanges;
}
function extractTextFromContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (!Array.isArray(content)) {
        return '';
    }
    return content
        .filter(block => block && typeof block === 'object' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n');
}
function safeParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function stringifyToolOutput(output) {
    if (output === undefined || output === null) {
        return undefined;
    }
    if (typeof output === 'string') {
        return output;
    }
    const text = extractTextFromContent(output);
    if (text.trim()) {
        return text;
    }
    return JSON.stringify(output);
}
function projectFromCwd(cwd) {
    if (!cwd) {
        return undefined;
    }
    const project = path.basename(cwd);
    return project || undefined;
}
function isoFromMillis(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function opencodeModelId(model) {
    if (!model || typeof model !== 'object') {
        return undefined;
    }
    const value = model;
    return value.id || value.modelID;
}
function opencodeModelProvider(model) {
    if (!model || typeof model !== 'object') {
        return undefined;
    }
    const value = model;
    return value.providerID;
}
function extractOpencodeText(parts) {
    if (!Array.isArray(parts)) {
        return '';
    }
    return parts
        .filter(part => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join('\n');
}
function timestampFromOpencodeMessage(message, fallback) {
    return isoFromMillis(message?.time?.completed) ||
        isoFromMillis(message?.time?.created) ||
        isoFromMillis(message?.timeUpdated) ||
        isoFromMillis(message?.timeCreated) ||
        fallback ||
        new Date().toISOString();
}
function extractOpencodeToolCalls(parts, fallbackTimestamp) {
    if (!Array.isArray(parts)) {
        return [];
    }
    const toolCalls = [];
    for (const part of parts) {
        if (!part || part.type !== 'tool') {
            continue;
        }
        const state = part.state || {};
        const timestamp = isoFromMillis(state.time?.start) ||
            isoFromMillis(part.time?.start) ||
            isoFromMillis(part.timeCreated) ||
            fallbackTimestamp;
        const status = typeof state.status === 'string' ? state.status.toLowerCase() : '';
        toolCalls.push({
            id: part.callID || part.id || crypto.randomUUID(),
            exchangeId: '',
            toolName: part.tool || 'unknown',
            toolInput: state.input,
            toolResult: stringifyToolOutput(state.output),
            isError: Boolean(status && status !== 'completed'),
            timestamp,
        });
    }
    return toolCalls;
}
async function parseOpencodeConversation(filePath, projectName, archivePath) {
    const exchanges = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    let lineNumber = 0;
    let sessionId;
    let cwd;
    let agentVersion;
    let agent;
    let model;
    let modelProvider;
    let currentExchange = null;
    const currentProject = () => projectFromCwd(cwd) || projectName;
    const applyMetadataToCurrentExchange = () => {
        if (!currentExchange) {
            return;
        }
        currentExchange.project = currentProject();
        currentExchange.sessionId = sessionId;
        currentExchange.cwd = cwd;
        currentExchange.agentVersion = agentVersion;
        currentExchange.model = model;
        currentExchange.modelProvider = modelProvider;
    };
    const finalizeExchange = () => {
        if (currentExchange && currentExchange.assistantMessages.length > 0) {
            applyMetadataToCurrentExchange();
            const exchangeId = crypto
                .createHash('md5')
                .update(`${archivePath}:${currentExchange.userLine}-${currentExchange.lastAssistantLine}`)
                .digest('hex');
            const toolCalls = currentExchange.toolCalls.map(tc => ({
                ...tc,
                exchangeId
            }));
            exchanges.push({
                id: exchangeId,
                project: currentExchange.project,
                timestamp: currentExchange.timestamp,
                userMessage: currentExchange.userMessage,
                assistantMessage: currentExchange.assistantMessages.join('\n\n'),
                archivePath,
                lineStart: currentExchange.userLine,
                lineEnd: currentExchange.lastAssistantLine,
                harness: 'opencode',
                sessionId: currentExchange.sessionId,
                cwd: currentExchange.cwd,
                agentVersion: currentExchange.agentVersion,
                model: currentExchange.model,
                modelProvider: currentExchange.modelProvider,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined
            });
        }
        currentExchange = null;
    };
    const startExchange = (text, timestamp) => {
        finalizeExchange();
        currentExchange = {
            project: currentProject(),
            userMessage: text,
            userLine: lineNumber,
            assistantMessages: [],
            lastAssistantLine: lineNumber,
            timestamp,
            harness: 'opencode',
            sessionId,
            cwd,
            agentVersion,
            model,
            modelProvider,
            toolCalls: []
        };
    };
    for await (const line of rl) {
        lineNumber++;
        if (!line.trim()) {
            continue;
        }
        try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'opencode_session' && parsed.session) {
                sessionId = parsed.session.id || sessionId;
                cwd = parsed.session.directory || parsed.project?.worktree || cwd;
                agentVersion = parsed.session.version || agentVersion;
                agent = parsed.session.agent || agent;
                model = opencodeModelId(parsed.session.model) || model;
                modelProvider = opencodeModelProvider(parsed.session.model) || modelProvider;
                applyMetadataToCurrentExchange();
                continue;
            }
            if (parsed.type !== 'opencode_message' || !parsed.message) {
                continue;
            }
            const message = parsed.message;
            const timestamp = timestampFromOpencodeMessage(message);
            if (message.sessionID || parsed.sessionID) {
                sessionId = message.sessionID || parsed.sessionID;
            }
            if (message.agent) {
                agent = message.agent;
            }
            if (message.path?.cwd) {
                cwd = message.path.cwd;
            }
            if (message.modelID) {
                model = message.modelID;
            }
            else if (message.model) {
                model = opencodeModelId(message.model) || model;
            }
            if (message.providerID) {
                modelProvider = message.providerID;
            }
            else if (message.model) {
                modelProvider = opencodeModelProvider(message.model) || modelProvider;
            }
            const text = extractOpencodeText(parsed.parts);
            if (message.role === 'user') {
                if (!text.trim()) {
                    continue;
                }
                startExchange(text, timestamp);
            }
            else if (message.role === 'assistant') {
                const exchange = currentExchange;
                if (exchange) {
                    if (text.trim()) {
                        exchange.assistantMessages.push(text);
                    }
                    exchange.lastAssistantLine = lineNumber;
                    exchange.timestamp = timestamp;
                    applyMetadataToCurrentExchange();
                    const toolCalls = extractOpencodeToolCalls(parsed.parts, timestamp);
                    if (toolCalls.length > 0) {
                        exchange.toolCalls.push(...toolCalls);
                    }
                }
            }
        }
        catch {
            continue;
        }
    }
    finalizeExchange();
    // Keep TypeScript aware that this intentionally tracks opencode's agent
    // name only as future metadata; the current DB schema stores version/model.
    void agent;
    return exchanges;
}
function extractOmpText(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (!Array.isArray(content)) {
        return '';
    }
    // Include only `text` blocks; skip `thinking` blocks (internal reasoning),
    // exactly as the Claude parser ignores thinking and opencode ignores reasoning.
    return content
        .filter(block => block && block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n');
}
/**
 * Parse an Oh My Pi (OMP) pi-lineage transcript.
 *
 * OMP entries form a TREE via id/parentId; the real conversation is the active
 * path from the current leaf back to the root. Active-leaf rule: the last
 * `type:"message"` entry in file order. Transcripts are append-only, so the
 * most recently written message is the current tip; abandoned/regenerated
 * branches remain earlier in the file but are not on the leaf's parentId chain.
 * We follow parentId from that leaf up to the root (a message whose parentId is
 * null/absent or not present in the file), then reverse to root->leaf order and
 * linearize. Because parents are always written before their children, line
 * numbers stay monotonic along the chain, keeping the #152 high-water mark and
 * #139 byte-cap correct. A streaming single pass can't do the leaf->root walk,
 * so we read every line with its line number first, then walk the tree.
 */
async function parseOmpConversation(filePath, projectName, archivePath) {
    const exchanges = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    let sessionId;
    let cwd;
    let headerTimestamp;
    const nodesById = new Map();
    let leafId;
    let lineNumber = 0;
    for await (const line of rl) {
        lineNumber++;
        if (!line.trim()) {
            continue;
        }
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (parsed.type === 'session') {
            sessionId = parsed.id ?? sessionId;
            cwd = parsed.cwd ?? cwd;
            headerTimestamp = parsed.timestamp ?? headerTimestamp;
            continue;
        }
        // Skip title/session_init/custom line types and malformed messages.
        if (parsed.type !== 'message' || !parsed.message || !parsed.message.role || !parsed.id) {
            continue;
        }
        const node = {
            id: parsed.id,
            parentId: parsed.parentId ?? undefined,
            role: parsed.message.role,
            text: extractOmpText(parsed.message.content),
            timestamp: parsed.timestamp || headerTimestamp || new Date().toISOString(),
            lineNumber
        };
        nodesById.set(node.id, node);
        leafId = node.id; // the last message wins as the active leaf
    }
    // Walk from the active leaf back to the root, guarding against cycles.
    const chain = [];
    const seen = new Set();
    let currentId = leafId;
    while (currentId && nodesById.has(currentId) && !seen.has(currentId)) {
        seen.add(currentId);
        const node = nodesById.get(currentId);
        chain.push(node);
        currentId = node.parentId;
    }
    chain.reverse(); // root -> leaf
    const project = projectFromCwd(cwd) || projectName;
    let currentExchange = null;
    const finalizeExchange = () => {
        if (currentExchange && currentExchange.assistantMessages.length > 0) {
            const exchangeId = crypto
                .createHash('md5')
                .update(`${archivePath}:${currentExchange.userLine}-${currentExchange.lastAssistantLine}`)
                .digest('hex');
            exchanges.push({
                id: exchangeId,
                project: currentExchange.project,
                timestamp: currentExchange.timestamp,
                userMessage: currentExchange.userMessage,
                assistantMessage: currentExchange.assistantMessages.join('\n\n'),
                archivePath,
                lineStart: currentExchange.userLine,
                lineEnd: currentExchange.lastAssistantLine,
                harness: 'omp',
                sessionId: currentExchange.sessionId,
                cwd: currentExchange.cwd
            });
        }
        currentExchange = null;
    };
    for (const node of chain) {
        if (node.role === 'user') {
            finalizeExchange();
            currentExchange = {
                project,
                userMessage: node.text || '(no content)',
                userLine: node.lineNumber,
                assistantMessages: [],
                lastAssistantLine: node.lineNumber,
                timestamp: node.timestamp,
                harness: 'omp',
                sessionId,
                cwd,
                toolCalls: []
            };
        }
        else if (node.role === 'assistant' && currentExchange) {
            if (node.text.trim()) {
                currentExchange.assistantMessages.push(node.text);
            }
            currentExchange.lastAssistantLine = node.lineNumber;
            currentExchange.timestamp = node.timestamp;
        }
    }
    finalizeExchange();
    return exchanges;
}
async function parseCodexConversation(filePath, projectName, archivePath) {
    const exchanges = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    let lineNumber = 0;
    let sessionId;
    let cwd;
    let gitBranch;
    let agentVersion;
    let model;
    let modelProvider;
    let currentExchange = null;
    const toolCallsByCallId = new Map();
    const currentProject = () => projectFromCwd(cwd) || projectName;
    const applyMetadataToCurrentExchange = () => {
        if (!currentExchange) {
            return;
        }
        currentExchange.project = currentProject();
        currentExchange.sessionId = sessionId;
        currentExchange.cwd = cwd;
        currentExchange.gitBranch = gitBranch;
        currentExchange.agentVersion = agentVersion;
        currentExchange.model = model;
        currentExchange.modelProvider = modelProvider;
    };
    const finalizeExchange = () => {
        if (currentExchange && currentExchange.assistantMessages.length > 0) {
            applyMetadataToCurrentExchange();
            const exchangeId = crypto
                .createHash('md5')
                .update(`${archivePath}:${currentExchange.userLine}-${currentExchange.lastAssistantLine}`)
                .digest('hex');
            const toolCalls = currentExchange.toolCalls.map(tc => ({
                ...tc,
                exchangeId
            }));
            exchanges.push({
                id: exchangeId,
                project: currentExchange.project,
                timestamp: currentExchange.timestamp,
                userMessage: currentExchange.userMessage,
                assistantMessage: currentExchange.assistantMessages.join('\n\n'),
                archivePath,
                lineStart: currentExchange.userLine,
                lineEnd: currentExchange.lastAssistantLine,
                harness: 'codex',
                sessionId: currentExchange.sessionId,
                cwd: currentExchange.cwd,
                gitBranch: currentExchange.gitBranch,
                agentVersion: currentExchange.agentVersion,
                model: currentExchange.model,
                modelProvider: currentExchange.modelProvider,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined
            });
        }
        currentExchange = null;
        toolCallsByCallId.clear();
    };
    const startExchange = (text, timestamp) => {
        finalizeExchange();
        currentExchange = {
            project: currentProject(),
            userMessage: text,
            userLine: lineNumber,
            assistantMessages: [],
            lastAssistantLine: lineNumber,
            timestamp,
            harness: 'codex',
            sessionId,
            cwd,
            gitBranch,
            agentVersion,
            model,
            modelProvider,
            toolCalls: []
        };
    };
    const appendToolCall = (payload, timestamp) => {
        if (!currentExchange) {
            return;
        }
        const callId = payload.call_id || crypto.randomUUID();
        let toolInput = payload.arguments;
        if (typeof toolInput === 'string') {
            toolInput = safeParseJson(toolInput);
        }
        else if (payload.input !== undefined) {
            toolInput = payload.input;
        }
        else if (payload.action !== undefined) {
            toolInput = payload.action;
        }
        const toolCall = {
            id: callId,
            exchangeId: '',
            toolName: payload.name || payload.namespace || payload.type || 'unknown',
            toolInput,
            isError: false,
            timestamp
        };
        currentExchange.toolCalls.push(toolCall);
        toolCallsByCallId.set(callId, toolCall);
        currentExchange.lastAssistantLine = lineNumber;
    };
    const appendToolResult = (payload) => {
        const callId = payload.call_id;
        if (!callId) {
            return;
        }
        const toolCall = toolCallsByCallId.get(callId);
        if (!toolCall) {
            return;
        }
        const output = stringifyToolOutput(payload.output);
        if (output !== undefined) {
            toolCall.toolResult = output;
        }
        currentExchange.lastAssistantLine = lineNumber;
    };
    for await (const line of rl) {
        lineNumber++;
        if (!line.trim()) {
            continue;
        }
        try {
            const parsed = JSON.parse(line);
            const payload = parsed.payload;
            const timestamp = parsed.timestamp || new Date().toISOString();
            if (parsed.type === 'session_meta' && payload) {
                sessionId = payload.id || sessionId;
                cwd = payload.cwd || cwd;
                gitBranch = payload.git?.branch || gitBranch;
                agentVersion = payload.cli_version || agentVersion;
                modelProvider = payload.model_provider || modelProvider;
                applyMetadataToCurrentExchange();
                continue;
            }
            if (parsed.type === 'turn_context' && payload) {
                cwd = payload.cwd || cwd;
                model = payload.model || model;
                applyMetadataToCurrentExchange();
                continue;
            }
            if (parsed.type !== 'response_item' || !payload) {
                continue;
            }
            if (payload.type === 'message') {
                const text = extractTextFromContent(payload.content);
                if (!text.trim()) {
                    continue;
                }
                if (payload.role === 'user') {
                    startExchange(text, timestamp);
                }
                else if (payload.role === 'assistant') {
                    const exchange = currentExchange;
                    if (exchange) {
                        exchange.assistantMessages.push(text);
                        exchange.lastAssistantLine = lineNumber;
                        exchange.timestamp = timestamp;
                    }
                }
            }
            else if (payload.type === 'function_call' || payload.type === 'custom_tool_call' || payload.type === 'tool_search_call' || payload.type === 'local_shell_call') {
                appendToolCall(payload, timestamp);
            }
            else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output' || payload.type === 'tool_search_output' || payload.type === 'local_shell_call_output') {
                appendToolResult(payload);
            }
        }
        catch {
            // Skip malformed JSON lines
            continue;
        }
    }
    finalizeExchange();
    return exchanges;
}
function stripFileScheme(value) {
    return value.startsWith('file://') ? decodeURI(value.slice('file://'.length)) : value;
}
/**
 * Cursor transcripts carry no workspace field; recover the working directory
 * from tool-call inputs: explicit cwd/working_directory values when present,
 * otherwise (with `useFilePathFallback`) the longest common directory prefix
 * of absolute paths the tools touched. The fallback is for the legacy vscdb
 * importer, which has no other signal; live transcripts have the project slug
 * in their path, which beats prefix guessing when no explicit cwd exists.
 */
export function detectCursorCwd(toolInputs, useFilePathFallback = false) {
    const cwdCounts = new Map();
    const filePaths = [];
    for (const input of toolInputs) {
        if (!input || typeof input !== 'object')
            continue;
        const params = input;
        for (const key of ['cwd', 'working_directory']) {
            const value = params[key];
            if (typeof value === 'string' && path.isAbsolute(value)) {
                cwdCounts.set(value, (cwdCounts.get(value) ?? 0) + 1);
            }
        }
        for (const key of ['targetFile', 'effectiveUri', 'path', 'target_directory']) {
            const value = params[key];
            if (typeof value === 'string') {
                const candidate = stripFileScheme(value);
                if (path.isAbsolute(candidate)) {
                    filePaths.push(candidate);
                }
            }
        }
    }
    if (cwdCounts.size > 0) {
        return [...cwdCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    if (!useFilePathFallback || filePaths.length === 0) {
        return undefined;
    }
    if (filePaths.length === 1) {
        return path.dirname(filePaths[0]);
    }
    let prefix = filePaths[0];
    for (const filePath of filePaths.slice(1)) {
        while (!filePath.startsWith(prefix)) {
            prefix = prefix.slice(0, -1);
            if (!prefix)
                return undefined;
        }
    }
    // Trim a partially matched final segment ("/repos/proj" matching
    // "/repos/project-a" and "/repos/project-b" must become "/repos").
    const lastSep = prefix.lastIndexOf(path.sep);
    if (lastSep <= 0)
        return undefined;
    const dir = prefix.slice(0, prefix.endsWith(path.sep) ? prefix.length - 1 : lastSep);
    // A one-segment prefix like "/Users" identifies no project.
    return dir.split(path.sep).filter(Boolean).length >= 2 ? dir : undefined;
}
function cursorProjectFromPath(filePath) {
    // Live transcripts live at <...>/<project-slug>/agent-transcripts/<uuid>/<uuid>.jsonl
    const parts = filePath.split(path.sep);
    const idx = parts.indexOf('agent-transcripts');
    if (idx > 0) {
        return parts[idx - 1];
    }
    return undefined;
}
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
async function parseCursorConversation(filePath, projectName, archivePath) {
    const exchanges = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    // Live Cursor transcripts carry no per-message timestamps; fall back to the
    // file mtime (preserved from the source by sync's copyIfNewer). Legacy
    // exports from import-cursor-history embed real per-message timestamps.
    let fallbackTimestamp;
    try {
        fallbackTimestamp = fs.statSync(filePath).mtime.toISOString();
    }
    catch {
        fallbackTimestamp = new Date().toISOString();
    }
    let sessionId = path.basename(filePath, '.jsonl').match(UUID_PATTERN)?.[0];
    let cwd; // only set by legacy-export lines
    const toolInputs = [];
    const slugProject = cursorProjectFromPath(archivePath) ?? cursorProjectFromPath(filePath);
    let lineNumber = 0;
    let currentExchange = null;
    const finalizeExchange = () => {
        if (currentExchange && currentExchange.assistantMessages.length > 0) {
            const exchangeId = crypto
                .createHash('md5')
                .update(`${archivePath}:${currentExchange.userLine}-${currentExchange.lastAssistantLine}`)
                .digest('hex');
            const toolCalls = currentExchange.toolCalls.map(tc => ({
                ...tc,
                exchangeId
            }));
            exchanges.push({
                id: exchangeId,
                project: currentExchange.project,
                timestamp: currentExchange.timestamp,
                userMessage: currentExchange.userMessage,
                assistantMessage: currentExchange.assistantMessages.join('\n\n'),
                archivePath,
                lineStart: currentExchange.userLine,
                lineEnd: currentExchange.lastAssistantLine,
                harness: 'cursor',
                sessionId: currentExchange.sessionId,
                cwd: currentExchange.cwd,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined
            });
        }
        currentExchange = null;
    };
    for await (const line of rl) {
        lineNumber++;
        if (!line.trim()) {
            continue;
        }
        try {
            const parsed = JSON.parse(line);
            // Skip status/error noise lines and anything that isn't a message
            if (!parsed.role || !parsed.message) {
                continue;
            }
            if (parsed.sessionId)
                sessionId = parsed.sessionId;
            if (parsed.cwd)
                cwd = parsed.cwd;
            const timestamp = parsed.timestamp || fallbackTimestamp;
            let text = '';
            const toolCalls = [];
            const content = parsed.message.content;
            if (typeof content === 'string') {
                text = content;
            }
            else if (Array.isArray(content)) {
                text = content
                    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
                    .map(block => block.text)
                    .join('\n');
                if (parsed.role === 'assistant') {
                    for (const block of content) {
                        if (block && block.type === 'tool_use') {
                            if (block.input !== undefined && block.input !== null) {
                                toolInputs.push(block.input);
                            }
                            toolCalls.push({
                                id: crypto.randomUUID(),
                                exchangeId: '',
                                toolName: block.name || 'unknown',
                                toolInput: block.input,
                                isError: false,
                                timestamp
                            });
                        }
                    }
                }
            }
            if (parsed.role === 'user') {
                // Cursor wraps the typed prompt in <user_query> tags; strip the
                // wrapper so embeddings see only the actual prompt text.
                text = text.replace(/<\/?user_query>/g, '').trim();
            }
            if (!text.trim() && toolCalls.length === 0) {
                continue;
            }
            if (parsed.role === 'user') {
                finalizeExchange();
                currentExchange = {
                    project: projectName,
                    userMessage: text || '(tool results only)',
                    userLine: lineNumber,
                    assistantMessages: [],
                    lastAssistantLine: lineNumber,
                    timestamp,
                    harness: 'cursor',
                    sessionId,
                    cwd,
                    toolCalls: []
                };
            }
            else if (parsed.role === 'assistant' && currentExchange) {
                if (text.trim()) {
                    currentExchange.assistantMessages.push(text);
                }
                currentExchange.lastAssistantLine = lineNumber;
                if (toolCalls.length > 0) {
                    currentExchange.toolCalls.push(...toolCalls);
                }
                if (parsed.timestamp) {
                    currentExchange.timestamp = parsed.timestamp;
                }
            }
        }
        catch {
            // Skip malformed JSON lines
            continue;
        }
    }
    finalizeExchange();
    // Live transcripts carry no cwd field; recover it from tool-call inputs and
    // apply the final values uniformly since a transcript is one session in one
    // project.
    cwd = cwd ?? detectCursorCwd(toolInputs);
    const project = projectFromCwd(cwd) || slugProject || projectName;
    for (const exchange of exchanges) {
        exchange.project = project;
        exchange.sessionId = exchange.sessionId ?? sessionId;
        exchange.cwd = exchange.cwd ?? cwd;
    }
    return exchanges;
}
/**
 * Convenience function to parse a conversation file
 * Extracts project name from the file path and returns exchanges with metadata
 */
export async function parseConversationFile(filePath) {
    // Extract project name from path (directory name before the .jsonl file)
    const pathParts = filePath.split('/');
    let project = 'unknown';
    // Find the parent directory name (second to last part)
    if (pathParts.length >= 2) {
        project = pathParts[pathParts.length - 2];
    }
    const exchanges = await parseConversation(filePath, project, filePath);
    return {
        project,
        exchanges
    };
}
