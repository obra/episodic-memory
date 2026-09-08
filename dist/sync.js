import fs from 'fs';
import path from 'path';
import { SUMMARIZER_CONTEXT_MARKER } from './constants.js';
import { getExcludedProjects, findJsonlFiles, statIfExists } from './paths.js';
import { formatErrorSentinel, shouldQueueForSummary } from './summary-sentinel.js';
const EXCLUSION_MARKERS = [
    '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>',
    'Only use NO_INSIGHTS_FOUND',
    SUMMARIZER_CONTEXT_MARKER,
];
function shouldSkipConversation(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return EXCLUSION_MARKERS.some(marker => content.includes(marker));
    }
    catch (error) {
        // If we can't read the file, don't skip it
        return false;
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
                        const sessionId = extractSessionIdFromPath(destFile);
                        if (sessionId) {
                            filesToSummarize.push({ path: destFile, sessionId });
                        }
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
            for (const file of filesToIndex) {
                try {
                    // Check for DO NOT INDEX marker
                    if (shouldSkipConversation(file)) {
                        continue; // Skip indexing but file is already copied
                    }
                    const project = path.basename(path.dirname(file));
                    const exchanges = await parseConversation(file, project, file);
                    for (const exchange of exchanges) {
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
            db.close();
        }
    }
    // Generate summaries for files that need them
    if (!options.skipSummaries && filesToSummarize.length > 0) {
        const { parseConversation } = await import('./parser.js');
        const { summarizeConversation } = await import('./summarizer.js');
        const summaryLimit = options.summaryLimit ?? 10;
        const toSummarize = filesToSummarize.slice(0, summaryLimit);
        const remaining = filesToSummarize.length - toSummarize.length;
        console.log(`Generating summaries for ${toSummarize.length} conversation(s)...`);
        if (remaining > 0) {
            console.log(`  (${remaining} more need summaries - will process on next sync)`);
        }
        for (const { path: filePath, sessionId } of toSummarize) {
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
            }
        }
    }
    return result;
}
