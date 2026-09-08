import fs from 'fs';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import { SUMMARIZER_CONTEXT_MARKER } from './constants.js';
import { getExcludedProjects, findJsonlFiles, statIfExists } from './paths.js';
import { formatErrorSentinel, shouldQueueForSummary } from './summary-sentinel.js';
import { getMaxMessageBytes, isOversizeExchange } from './message-size.js';
const EXCLUSION_MARKERS = [
    '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>',
    'Only use NO_INSIGHTS_FOUND',
    SUMMARIZER_CONTEXT_MARKER,
];
const MARKER_SCAN_CHUNK_BYTES = 1 << 20; // 1 MiB
/**
 * Stream and scan for any exclusion marker, carrying an overlap between
 * chunks so a marker split across a boundary is still found. A single
 * fs.readFileSync(path, 'utf-8') throws ERR_STRING_TOO_LONG above Node's
 * ~512 MB max string length; the old catch returned false (fail OPEN),
 * silently indexing a file whose DO NOT INDEX marker we never read (#152).
 * Streaming confirms cleanliness at any size, and a real read error now
 * fails CLOSED (skip) rather than open.
 */
export function shouldSkipConversation(filePath) {
    const maxMarkerLen = Math.max(...EXCLUSION_MARKERS.map(m => m.length));
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        const buf = Buffer.allocUnsafe(MARKER_SCAN_CHUNK_BYTES);
        const decoder = new StringDecoder('utf8');
        let carry = '';
        let bytesRead;
        while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
            const window = carry + decoder.write(buf.subarray(0, bytesRead));
            if (EXCLUSION_MARKERS.some(marker => window.includes(marker))) {
                return true;
            }
            carry = window.slice(Math.max(0, window.length - (maxMarkerLen - 1)));
        }
        const tail = carry + decoder.end();
        return EXCLUSION_MARKERS.some(marker => tail.includes(marker));
    }
    catch {
        return true; // fail closed (#152)
    }
    finally {
        if (fd !== undefined) {
            try {
                fs.closeSync(fd);
            }
            catch { }
        }
    }
}
/**
 * True when a transcript contains at least one message line in any supported
 * harness format. Summarizer-spawned Agent SDK sessions materialize as
 * message-less stub files (a single {"type":"ai-title"} line) that defeat the
 * marker-based exclusion above and would otherwise re-enter the sync queue on
 * every run — one new stub per summary generated. A transcript that has no
 * messages *yet* (a session that just started) is skipped this run and picked
 * up on a later sync once it has content, since its mtime keeps advancing.
 */
function hasConversationContent(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        for (const line of content.split('\n')) {
            if (!line.trim())
                continue;
            try {
                const parsed = JSON.parse(line);
                // Claude: {type: "user"|"assistant", message: {...}}
                if ((parsed.type === 'user' || parsed.type === 'assistant') && parsed.message) {
                    return true;
                }
                // Codex: {type: "response_item"|..., payload: {...}}
                if (parsed.payload) {
                    return true;
                }
                // Cursor: {role: "user"|"assistant", message: {...}}
                if (parsed.role && parsed.message) {
                    return true;
                }
                // opencode: {type: "opencode_message", message: {...}, parts: [...]}.
                // The message line has no top-level `role` and its `type` is neither
                // user nor assistant, so without this branch #113's pre-copy guard would
                // skip every opencode transcript before it is copied/indexed/summarized.
                if (parsed.type === 'opencode_message' && parsed.message) {
                    return true;
                }
                // OMP: {type: "message", message: {role, content}, id, parentId}.
                // A session-header-only file has no message lines and is still skipped.
                if (parsed.type === 'message' && parsed.message && parsed.message.role) {
                    return true;
                }
            }
            catch {
                continue;
            }
        }
        return false;
    }
    catch {
        // If we can't read the file, let the normal pipeline handle it
        return true;
    }
}
/**
 * Derive sync options from the process environment.
 *
 * `EPISODIC_MEMORY_SKIP_SUMMARIES=1` turns the summarization pass off.
 * Only the exact string '1' enables the switch — unset, '0', 'true',
 * and anything else leave summarization on, so a stray value can't
 * silently disable a feature the user still expects.
 *
 * Why anyone wants this: summaries are display-only. search.ts reads
 * the `-summary.txt` sidecar solely to decorate result output; summary
 * text is never embedded and never searched, so skipping it leaves
 * recall untouched. The summarizer, by contrast, resumes each
 * conversation through the Claude Agent SDK, which spends the user's
 * Claude quota and can stall on a permission prompt.
 */
export function buildSyncOptionsFromEnv(env) {
    return { skipSummaries: env.EPISODIC_MEMORY_SKIP_SUMMARIES === '1' };
}
function copyIfNewer(src, dest) {
    // Ensure destination directory exists
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    // Check if destination exists and is up-to-date
    if (fs.existsSync(dest)) {
        const srcStat = fs.statSync(src);
        const destStat = fs.statSync(dest);
        if (destStat.mtimeMs >= srcStat.mtimeMs) {
            return false; // Dest is current, skip
        }
    }
    // Atomic copy: temp file + rename
    const tempDest = dest + '.tmp.' + process.pid;
    fs.copyFileSync(src, tempDest);
    fs.renameSync(tempDest, dest); // Atomic on same filesystem
    // Preserve source mtime: harnesses without per-message timestamps (Cursor
    // agent transcripts) fall back to file mtime. Round up to the next whole
    // millisecond — utimes can't always represent the source's sub-millisecond
    // precision, and a dest mtime even fractionally older would defeat the
    // skip-if-current check above on every subsequent sync.
    const srcStat = fs.statSync(src);
    fs.utimesSync(dest, srcStat.atimeMs / 1000, Math.ceil(srcStat.mtimeMs) / 1000);
    return true;
}
export function extractSessionIdFromPath(filePath) {
    // Extract session ID from Claude filename or Codex rollout filename.
    const basename = path.basename(filePath, '.jsonl');
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
    const matches = basename.match(uuidPattern);
    if (matches && matches.length > 0) {
        return matches[matches.length - 1];
    }
    return null;
}
export async function syncConversations(sourceDir, destDir, options = {}) {
    const result = {
        copied: 0,
        skipped: 0,
        indexed: 0,
        summarized: 0,
        errors: []
    };
    // Ensure source directory exists
    if (!fs.existsSync(sourceDir)) {
        return result;
    }
    // Collect files to index and summarize
    const filesToIndex = [];
    const filesToSummarize = [];
    // Walk source directory
    const projects = fs.readdirSync(sourceDir);
    const excludedProjects = getExcludedProjects();
    const excludedDirSet = new Set(excludedProjects);
    for (const project of projects) {
        if (excludedProjects.includes(project)) {
            console.log("\nSkipping excluded project: " + project);
            continue;
        }
        const projectPath = path.join(sourceDir, project);
        const stat = statIfExists(projectPath);
        if (!stat?.isDirectory())
            continue;
        const files = findJsonlFiles(projectPath, excludedDirSet);
        for (const file of files) {
            const srcFile = path.join(projectPath, file);
            const destFile = path.join(destDir, project, file);
            try {
                // Skip message-less transcripts (summarizer-spawned stubs, sessions
                // that haven't produced content yet) before they enter the archive.
                if (!hasConversationContent(srcFile)) {
                    result.skipped++;
                    continue;
                }
                const wasCopied = copyIfNewer(srcFile, destFile);
                if (wasCopied) {
                    result.copied++;
                    filesToIndex.push(destFile);
                }
                else {
                    result.skipped++;
                }
                // Check if this file needs a summary (whether newly copied or existing).
                // shouldQueueForSummary skips files that already have a real summary or
                // an empty zero-exchange sentinel, and retries stale error sentinels (#96).
                if (!options.skipSummaries) {
                    const summaryPath = destFile.replace('.jsonl', '-summary.txt');
                    if (shouldQueueForSummary(summaryPath) && !shouldSkipConversation(destFile)) {
                        // sessionId enables Claude session-resume summarization; when the
                        // filename has no UUID to extract (e.g. subagent transcripts named
                        // agent-<hex>.jsonl), queue anyway — summarizeConversation falls
                        // back to summarizing from the transcript text.
                        const sessionId = extractSessionIdFromPath(destFile) ?? undefined;
                        filesToSummarize.push({ path: destFile, sessionId });
                    }
                }
            }
            catch (error) {
                result.errors.push({
                    file: srcFile,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }
    // Index copied files (unless skipIndex is set)
    if (!options.skipIndex && filesToIndex.length > 0) {
        const { parseConversation } = await import('./parser.js');
        // Load the embedding backend first. It can fail on hosts where sharp's
        // native binding (pulled in transitively by @huggingface/transformers)
        // can't dlopen libvips (#135). That must not abort the whole sync — copying
        // has already happened and summaries still need to run — so surface a
        // clear, actionable error and skip semantic indexing for this run instead
        // of throwing out of syncConversations (which would crash the SessionStart
        // hook that invokes it).
        let embeddings = null;
        try {
            embeddings = await import('./embeddings.js');
            await embeddings.initEmbeddings();
        }
        catch (error) {
            embeddings = null;
            result.errors.push({
                file: '(embeddings)',
                error: `Semantic indexing skipped — embedding backend unavailable: ${error instanceof Error ? error.message : String(error)}`,
            });
            console.error('episodic-memory: embedding backend failed to load; skipping semantic ' +
                'indexing this run (copying and summaries still run). See the error above.');
        }
        if (embeddings) {
            const { initDatabase, insertExchange } = await import('./db.js');
            const { generateExchangeEmbedding } = embeddings;
            const db = initDatabase();
            const maxMessageBytes = getMaxMessageBytes();
            let oversizeSkipped = 0;
            for (const file of filesToIndex) {
                try {
                    // Check for DO NOT INDEX marker
                    if (shouldSkipConversation(file)) {
                        continue; // Skip indexing but file is already copied
                    }
                    // High-water mark: index exchanges past the last line we've already
                    // covered. Transcript JSONLs are append-only, so MAX(line_end) tells
                    // us where to resume — without this, a grown transcript re-embeds
                    // every exchange on every sync (#152). Ported from indexer.ts.
                    const hw = db.prepare('SELECT COALESCE(MAX(line_end), 0) as maxLine FROM exchanges WHERE archive_path = ?').get(file);
                    const maxIndexedLine = hw.maxLine;
                    const project = path.basename(path.dirname(file));
                    const exchanges = await parseConversation(file, project, file);
                    const newExchanges = maxIndexedLine > 0
                        ? exchanges.filter(e => e.lineStart > maxIndexedLine)
                        : exchanges;
                    for (const exchange of newExchanges) {
                        // Skip oversize single messages BEFORE embedding — a foreign
                        // summarizer's pasted transcript is noise, and embedding it is the
                        // expensive waste (#139).
                        if (isOversizeExchange(exchange, maxMessageBytes)) {
                            oversizeSkipped++;
                            continue;
                        }
                        const toolNames = exchange.toolCalls?.map(tc => tc.toolName);
                        const embedding = await generateExchangeEmbedding(exchange.userMessage, exchange.assistantMessage, toolNames);
                        insertExchange(db, exchange, embedding, toolNames);
                    }
                    result.indexed++;
                }
                catch (error) {
                    result.errors.push({
                        file,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            if (oversizeSkipped > 0) {
                console.log(`  Skipped ${oversizeSkipped} oversize exchange(s) (> ${maxMessageBytes} bytes; set EPISODIC_MEMORY_MAX_MESSAGE_BYTES to change) — likely embedded-transcript payloads (#139)`);
            }
            db.close();
        }
    }
    // Generate summaries for files that need them
    if (!options.skipSummaries && filesToSummarize.length > 0) {
        const { parseConversation } = await import('./parser.js');
        const { summarizeConversation, isAuthFailure } = await import('./summarizer.js');
        const summaryLimit = options.summaryLimit ?? 10;
        const toSummarize = filesToSummarize.slice(0, summaryLimit);
        const remaining = filesToSummarize.length - toSummarize.length;
        console.log(`Generating summaries for ${toSummarize.length} conversation(s)...`);
        if (remaining > 0) {
            console.log(`  (${remaining} more need summaries - will process on next sync)`);
        }
        // A global failure (expired Claude CLI OAuth, #138) is not per-file. After
        // the first, skip the rest of this batch with
        // error sentinels so we don't burn minutes re-billing doomed calls or spam the
        // same message per file. The skipped files re-queue on the next sync.
        let stopBatch = false;
        let stopBatchMessage = '';
        for (const { path: filePath, sessionId } of toSummarize) {
            if (stopBatch) {
                try {
                    const summaryPath = filePath.replace('.jsonl', '-summary.txt');
                    fs.writeFileSync(summaryPath, formatErrorSentinel(new Error(stopBatchMessage)), 'utf-8');
                }
                catch { }
                result.errors.push({
                    file: filePath,
                    error: `Summary generation skipped: ${stopBatchMessage}`,
                });
                continue;
            }
            try {
                const project = path.basename(path.dirname(filePath));
                const exchanges = await parseConversation(filePath, project, filePath);
                if (exchanges.length === 0) {
                    // Skip empty conversations — write an empty -summary.txt sentinel so they aren't re-queued forever
                    const summaryPath = filePath.replace('.jsonl', '-summary.txt');
                    fs.writeFileSync(summaryPath, '', 'utf-8');
                    continue;
                }
                console.log(`  Summarizing ${path.basename(filePath)} (${exchanges.length} exchanges)...`);
                const summary = await summarizeConversation(exchanges, sessionId);
                const summaryPath = filePath.replace('.jsonl', '-summary.txt');
                fs.writeFileSync(summaryPath, summary, 'utf-8');
                result.summarized++;
            }
            catch (error) {
                // Write a structured error sentinel (#96): distinct from the empty
                // zero-exchange sentinel so a stale failure can self-heal on the next
                // sync run past the retry threshold. The marker also keeps the error
                // text on disk for post-hoc diagnosis. Best-effort — if the sentinel
                // write itself fails, fall through and surface the original error.
                try {
                    const summaryPath = filePath.replace('.jsonl', '-summary.txt');
                    fs.writeFileSync(summaryPath, formatErrorSentinel(error), 'utf-8');
                }
                catch { }
                result.errors.push({
                    file: filePath,
                    error: `Summary generation failed: ${error instanceof Error ? error.message : String(error)}`
                });
                // Stop the batch on a global failure (expired auth).
                if (isAuthFailure(error)) {
                    stopBatch = true;
                    stopBatchMessage =
                        'Claude CLI authentication failed — run `claude` and re-authenticate; summaries will retry on the next sync.';
                    console.error(`  ${stopBatchMessage}`);
                }
            }
        }
    }
    return result;
}
