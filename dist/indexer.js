import fs from 'fs';
import path from 'path';
import { initDatabase, insertExchange } from './db.js';
import { parseConversation } from './parser.js';
import { initEmbeddings, generateExchangeEmbedding } from './embeddings.js';
import { summarizeConversation } from './summarizer.js';
import { getArchiveDir, getExcludedProjects, getConversationSourceDirs, findJsonlFiles } from './paths.js';
// Set max output tokens for Claude SDK (used by summarizer)
process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '20000';
// Increase max listeners for concurrent API calls
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 20;
// Process items in batches with limited concurrency
async function processBatch(items, processor, concurrency) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);
    }
    return results;
}
function sessionIdForSummary(exchanges) {
    return exchanges.find(exchange => exchange.sessionId)?.sessionId;
}
export async function indexConversations(limitToProject, maxConversations, concurrency = 1, noSummaries = false) {
    console.log('Initializing database...');
    const db = initDatabase();
    console.log('Loading embedding model...');
    await initEmbeddings();
    if (noSummaries) {
        console.log('⚠️  Running in no-summaries mode (skipping AI summaries)');
    }
    console.log('Scanning for conversation files...');
    const sourceDirs = getConversationSourceDirs();
    const ARCHIVE_DIR = getArchiveDir();
    let totalExchanges = 0;
    let conversationsProcessed = 0;
    const excludedProjects = getExcludedProjects();
    const excludedDirSet = new Set(excludedProjects);
    for (const sourceDir of sourceDirs) {
        const projects = fs.readdirSync(sourceDir);
        for (const project of projects) {
            // Skip excluded projects
            if (excludedProjects.includes(project)) {
                console.log(`\nSkipping excluded project: ${project}`);
                continue;
            }
            // Skip if limiting to specific project
            if (limitToProject && project !== limitToProject)
                continue;
            const projectPath = path.join(sourceDir, project);
            const stat = fs.statSync(projectPath);
            if (!stat.isDirectory())
                continue;
            const files = findJsonlFiles(projectPath, excludedDirSet);
            if (files.length === 0)
                continue;
            console.log(`\nProcessing project: ${project} (${files.length} conversations)`);
            if (concurrency > 1)
                console.log(`  Concurrency: ${concurrency}`);
            // Create archive directory for this project
            const projectArchive = path.join(ARCHIVE_DIR, project);
            fs.mkdirSync(projectArchive, { recursive: true });
            const toProcess = [];
            for (const file of files) {
                const sourcePath = path.join(projectPath, file);
                const archivePath = path.join(projectArchive, file);
                // Copy to archive (ensure parent dirs exist for subagent files)
                if (!fs.existsSync(archivePath)) {
                    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
                    fs.copyFileSync(sourcePath, archivePath);
                    console.log(`  Archived: ${file}`);
                }
                // Parse conversation
                const exchanges = await parseConversation(sourcePath, project, archivePath);
                if (exchanges.length === 0) {
                    console.log(`  Skipped ${file} (no exchanges)`);
                    continue;
                }
                toProcess.push({
                    file,
                    sourcePath,
                    archivePath,
                    summaryPath: archivePath.replace('.jsonl', '-summary.txt'),
                    exchanges
                });
            }
            // Batch summarize conversations in parallel (unless --no-summaries)
            if (!noSummaries) {
                const needsSummary = toProcess.filter(c => !fs.existsSync(c.summaryPath));
                if (needsSummary.length > 0) {
                    console.log(`  Generating ${needsSummary.length} summaries (concurrency: ${concurrency})...`);
                    await processBatch(needsSummary, async (conv) => {
                        try {
                            const summary = await summarizeConversation(conv.exchanges, sessionIdForSummary(conv.exchanges));
                            fs.writeFileSync(conv.summaryPath, summary, 'utf-8');
                            const wordCount = summary.split(/\s+/).length;
                            console.log(`  ✓ ${conv.file}: ${wordCount} words`);
                            return summary;
                        }
                        catch (error) {
                            console.log(`  ✗ ${conv.file}: ${error}`);
                            return null;
                        }
                    }, concurrency);
                }
            }
            else {
                console.log(`  Skipping ${toProcess.length} summaries (--no-summaries mode)`);
            }
            // Now process embeddings and DB inserts (fast, sequential is fine)
            for (const conv of toProcess) {
                for (const exchange of conv.exchanges) {
                    const toolNames = exchange.toolCalls?.map(tc => tc.toolName);
                    const embedding = await generateExchangeEmbedding(exchange.userMessage, exchange.assistantMessage, toolNames);
                    insertExchange(db, exchange, embedding, toolNames);
                }
                totalExchanges += conv.exchanges.length;
                conversationsProcessed++;
                // Check if we hit the limit
                if (maxConversations && conversationsProcessed >= maxConversations) {
                    console.log(`\nReached limit of ${maxConversations} conversations`);
                    db.close();
                    console.log(`✅ Indexing complete! Conversations: ${conversationsProcessed}, Exchanges: ${totalExchanges}`);
                    return;
                }
            }
        }
    } // end sourceDir loop
    db.close();
    console.log(`\n✅ Indexing complete! Conversations: ${conversationsProcessed}, Exchanges: ${totalExchanges}`);
}
export async function indexSession(sessionId, concurrency = 1, noSummaries = false) {
    console.log(`Indexing session: ${sessionId}`);
    // Find the conversation file for this session
    const sourceDirs = getConversationSourceDirs();
    const ARCHIVE_DIR = getArchiveDir();
    const excludedProjects = getExcludedProjects();
    const excludedDirSet = new Set(excludedProjects);
    let found = false;
    for (const sourceDir of sourceDirs) {
        const projects = fs.readdirSync(sourceDir);
        for (const project of projects) {
            if (excludedProjects.includes(project))
                continue;
            const projectPath = path.join(sourceDir, project);
            if (!fs.statSync(projectPath).isDirectory())
                continue;
            const files = findJsonlFiles(projectPath, excludedDirSet).filter(f => f.includes(sessionId));
            if (files.length > 0) {
                found = true;
                const file = files[0];
                const sourcePath = path.join(projectPath, file);
                const db = initDatabase();
                await initEmbeddings();
                const projectArchive = path.join(ARCHIVE_DIR, project);
                fs.mkdirSync(projectArchive, { recursive: true });
                const archivePath = path.join(projectArchive, file);
                // Archive (ensure parent dirs exist for subagent files)
                if (!fs.existsSync(archivePath)) {
                    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
                    fs.copyFileSync(sourcePath, archivePath);
                }
                // Parse and summarize
                const exchanges = await parseConversation(sourcePath, project, archivePath);
                if (exchanges.length > 0) {
                    // Generate summary (unless --no-summaries)
                    const summaryPath = archivePath.replace('.jsonl', '-summary.txt');
                    if (!noSummaries && !fs.existsSync(summaryPath)) {
                        fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
                        const summary = await summarizeConversation(exchanges, sessionIdForSummary(exchanges));
                        fs.writeFileSync(summaryPath, summary, 'utf-8');
                        console.log(`Summary: ${summary.split(/\s+/).length} words`);
                    }
                    // Index
                    for (const exchange of exchanges) {
                        const toolNames = exchange.toolCalls?.map(tc => tc.toolName);
                        const embedding = await generateExchangeEmbedding(exchange.userMessage, exchange.assistantMessage, toolNames);
                        insertExchange(db, exchange, embedding, toolNames);
                    }
                    console.log(`✅ Indexed session ${sessionId}: ${exchanges.length} exchanges`);
                }
                db.close();
                break;
            }
        }
        if (found)
            break;
    } // end sourceDir loop
    if (!found) {
        console.log(`Session ${sessionId} not found`);
    }
}
export async function indexUnprocessed(concurrency = 1, noSummaries = false) {
    console.log('Finding unprocessed conversations...');
    if (concurrency > 1)
        console.log(`Concurrency: ${concurrency}`);
    if (noSummaries)
        console.log('⚠️  Running in no-summaries mode (skipping AI summaries)');
    const db = initDatabase();
    await initEmbeddings();
    const sourceDirs = getConversationSourceDirs();
    const ARCHIVE_DIR = getArchiveDir();
    const excludedProjects = getExcludedProjects();
    const excludedDirSet = new Set(excludedProjects);
    const unprocessed = [];
    // Collect all unprocessed conversations from all source dirs
    for (const sourceDir of sourceDirs) {
        const projects = fs.readdirSync(sourceDir);
        for (const project of projects) {
            if (excludedProjects.includes(project))
                continue;
            const projectPath = path.join(sourceDir, project);
            if (!fs.statSync(projectPath).isDirectory())
                continue;
            const files = findJsonlFiles(projectPath, excludedDirSet);
            for (const file of files) {
                const sourcePath = path.join(projectPath, file);
                const projectArchive = path.join(ARCHIVE_DIR, project);
                const archivePath = path.join(projectArchive, file);
                const summaryPath = archivePath.replace('.jsonl', '-summary.txt');
                // High-water mark: index exchanges past the last line we've already covered.
                // Transcript JSONLs are append-only, so MAX(line_end) tells us where to resume.
                const hw = db.prepare('SELECT COALESCE(MAX(line_end), 0) as maxLine FROM exchanges WHERE archive_path = ?').get(archivePath);
                const maxIndexedLine = hw.maxLine;
                // Ensure parent dirs exist for subagent files
                fs.mkdirSync(path.dirname(archivePath), { recursive: true });
                // Refresh the archive when the source may have grown beyond what we've seen.
                if (!fs.existsSync(archivePath) || maxIndexedLine > 0) {
                    fs.copyFileSync(sourcePath, archivePath);
                }
                // Parse and filter to exchanges past the high-water mark
                const exchanges = await parseConversation(sourcePath, project, archivePath);
                const newExchanges = maxIndexedLine > 0
                    ? exchanges.filter(e => e.lineStart > maxIndexedLine)
                    : exchanges;
                if (newExchanges.length === 0)
                    continue;
                unprocessed.push({ project, file, sourcePath, archivePath, summaryPath, exchanges: newExchanges });
            }
        }
    } // end sourceDir loop
    if (unprocessed.length === 0) {
        console.log('✅ All conversations are already processed!');
        db.close();
        return;
    }
    console.log(`Found ${unprocessed.length} unprocessed conversations`);
    // Batch process summaries (unless --no-summaries)
    if (!noSummaries) {
        const needsSummary = unprocessed.filter(c => !fs.existsSync(c.summaryPath));
        if (needsSummary.length > 0) {
            console.log(`Generating ${needsSummary.length} summaries (concurrency: ${concurrency})...\n`);
            await processBatch(needsSummary, async (conv) => {
                try {
                    const summary = await summarizeConversation(conv.exchanges, sessionIdForSummary(conv.exchanges));
                    fs.writeFileSync(conv.summaryPath, summary, 'utf-8');
                    const wordCount = summary.split(/\s+/).length;
                    console.log(`  ✓ ${conv.project}/${conv.file}: ${wordCount} words`);
                    return summary;
                }
                catch (error) {
                    console.log(`  ✗ ${conv.project}/${conv.file}: ${error}`);
                    return null;
                }
            }, concurrency);
        }
    }
    else {
        console.log(`Skipping summaries for ${unprocessed.length} conversations (--no-summaries mode)\n`);
    }
    // Now index embeddings
    console.log(`\nIndexing embeddings...`);
    for (const conv of unprocessed) {
        for (const exchange of conv.exchanges) {
            const toolNames = exchange.toolCalls?.map(tc => tc.toolName);
            const embedding = await generateExchangeEmbedding(exchange.userMessage, exchange.assistantMessage, toolNames);
            insertExchange(db, exchange, embedding, toolNames);
        }
    }
    db.close();
    console.log(`\n✅ Processed ${unprocessed.length} conversations`);
}
