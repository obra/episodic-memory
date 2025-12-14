import fs from 'fs';
import path from 'path';
import { SUMMARIZER_CONTEXT_MARKER } from './constants.js';
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
function extractSessionIdFromPath(filePath) {
    // Extract session ID from filename: /path/to/abc-123-def.jsonl -> abc-123-def
    const basename = path.basename(filePath, '.jsonl');
    // Session IDs are UUIDs, validate format
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(basename)) {
        return basename;
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
    for (const project of projects) {
        const projectPath = path.join(sourceDir, project);
        const stat = fs.statSync(projectPath);
        if (!stat.isDirectory())
            continue;
        const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
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
                // Check if this file needs a summary (whether newly copied or existing)
                if (!options.skipSummaries) {
                    const summaryPath = destFile.replace('.jsonl', '-summary.txt');
                    if (!fs.existsSync(summaryPath) && !shouldSkipConversation(destFile)) {
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
        const { initDatabase, insertExchange } = await import('./db.js');
        const { initEmbeddings, generateExchangeEmbedding } = await import('./embeddings.js');
        const { parseConversation } = await import('./parser.js');
        const db = initDatabase();
        await initEmbeddings();
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
                    continue; // Skip empty conversations
                }
                console.log(`  Summarizing ${path.basename(filePath)} (${exchanges.length} exchanges)...`);
                const summary = await summarizeConversation(exchanges);
                const summaryPath = filePath.replace('.jsonl', '-summary.txt');
                fs.writeFileSync(summaryPath, summary, 'utf-8');
                result.summarized++;
            }
            catch (error) {
                result.errors.push({
                    file: filePath,
                    error: `Summary generation failed: ${error instanceof Error ? error.message : String(error)}`
                });
            }
        }
    }
    return result;
}
