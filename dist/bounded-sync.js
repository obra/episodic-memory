import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { findJsonlFiles, getExcludedProjects } from './paths.js';
import { deleteExchangesForArchiveObject, initDatabase, insertExchange } from './db.js';
import { getArchiveObject, putArchiveObject } from './archive-ledger.js';
import { checkCacheCapacity, hashFile, RcloneTransport, RunBudget } from './rclone-transport.js';
export async function syncBoundedSourceDirs(options) {
    if (!options.remoteBase || !options.remoteBase.includes(':'))
        throw new Error('remoteBase must be an rclone remote path');
    fs.mkdirSync(options.cacheDir, { recursive: true });
    const db = initDatabase(options.dbPath);
    const transport = options.transport ?? new RcloneTransport();
    const budget = options.budget ?? new RunBudget();
    const freeBytes = options.freeBytes ?? (dir => Number(fs.statfsSync(dir).bavail) * Number(fs.statfsSync(dir).bsize));
    const prepare = options.prepare ?? prepareConversation;
    const result = { uploaded: 0, indexed: 0, skipped: 0, errors: [] };
    try {
        const excluded = new Set(getExcludedProjects());
        const files = enumerate(options.sourceDirs, excluded);
        for (const item of files) {
            const sourceStat = fs.statSync(item.sourcePath);
            const gate = budget.canStart(sourceStat.size);
            if (!gate.allowed) {
                result.boundedStop = gate.reason;
                break;
            }
            const capacity = checkCacheCapacity(directorySize(options.cacheDir), sourceStat.size, freeBytes(options.cacheDir));
            if (!capacity.allowed) {
                result.boundedStop = capacity.reason;
                break;
            }
            const remoteKey = `${options.remoteBase.replace(/\/$/, '')}/${item.project}/${item.relativePath.split(path.sep).join('/')}`;
            const objectId = createHash('sha256').update(remoteKey).digest('hex');
            const existing = getArchiveObject(db, objectId);
            if (existing && existing.sourceMtimeMs === Math.trunc(sourceStat.mtimeMs) && existing.sizeBytes === sourceStat.size) {
                result.skipped += 1;
                continue;
            }
            const staged = path.join(options.cacheDir, `${objectId}.jsonl`);
            try {
                fs.copyFileSync(item.sourcePath, staged);
                const localProof = await hashFile(staged);
                const lineCount = await countLines(staged);
                const prepared = await prepare(staged, item.project, remoteKey, objectId);
                const remoteProof = await transport.uploadVerified(staged, remoteKey);
                if (localProof.bytes !== remoteProof.bytes || localProof.sha256 !== remoteProof.sha256) {
                    throw new Error(`remote integrity mismatch for ${remoteKey}`);
                }
                const now = Date.now();
                const publish = db.transaction(() => {
                    deleteExchangesForArchiveObject(db, objectId);
                    putArchiveObject(db, {
                        id: objectId, remoteKey, project: item.project, sha256: remoteProof.sha256,
                        sizeBytes: remoteProof.bytes, lineCount, sourceMtimeMs: Math.trunc(sourceStat.mtimeMs),
                        summaryText: prepared.summaryText, summaryState: prepared.summaryState,
                        uploadState: 'uploaded', uploadedAtMs: now, verifiedAtMs: now,
                    });
                    for (const entry of prepared.exchanges)
                        insertExchange(db, entry.exchange, entry.embedding, entry.toolNames);
                });
                publish();
                budget.record(remoteProof.bytes);
                result.uploaded += 1;
                result.indexed += prepared.exchanges.length > 0 ? 1 : 0;
            }
            catch (error) {
                result.errors.push({ file: item.sourcePath, error: error instanceof Error ? error.message : String(error) });
            }
            finally {
                try {
                    fs.unlinkSync(staged);
                }
                catch { }
            }
        }
    }
    finally {
        db.close();
    }
    return result;
}
function enumerate(sourceDirs, excluded) {
    const items = [];
    for (const sourceDir of sourceDirs) {
        if (!fs.existsSync(sourceDir))
            continue;
        for (const project of fs.readdirSync(sourceDir).sort()) {
            if (excluded.has(project))
                continue;
            const projectPath = path.join(sourceDir, project);
            if (!fs.statSync(projectPath).isDirectory())
                continue;
            for (const relativePath of findJsonlFiles(projectPath, excluded).sort()) {
                items.push({ sourcePath: path.join(projectPath, relativePath), project, relativePath });
            }
        }
    }
    return items;
}
function directorySize(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        total += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
    }
    return total;
}
async function countLines(filePath) {
    let count = 0;
    let sawData = false;
    let last = 0;
    for await (const chunk of fs.createReadStream(filePath)) {
        sawData = true;
        for (const byte of chunk)
            if (byte === 10)
                count += 1;
        last = chunk[chunk.length - 1];
    }
    return count + (sawData && last !== 10 ? 1 : 0);
}
async function prepareConversation(localPath, project, remoteKey, objectId) {
    const { parseConversation } = await import('./parser.js');
    const { initEmbeddings, generateExchangeEmbedding } = await import('./embeddings.js');
    const { summarizeConversation } = await import('./summarizer.js');
    const exchanges = await parseConversation(localPath, project, remoteKey);
    for (const exchange of exchanges)
        exchange.archiveObjectId = objectId;
    let summaryText = null;
    let summaryState = exchanges.length === 0 ? 'empty' : 'missing';
    if (exchanges.length > 0 && process.env.EPISODIC_MEMORY_SKIP_SUMMARIES !== '1') {
        try {
            summaryText = await summarizeConversation(exchanges, exchanges.find(e => e.sessionId)?.sessionId);
            summaryState = 'ready';
        }
        catch {
            summaryState = 'error';
        }
    }
    await initEmbeddings();
    const prepared = [];
    for (const exchange of exchanges) {
        const toolNames = exchange.toolCalls?.map(call => call.toolName);
        const embedding = await generateExchangeEmbedding(exchange.userMessage, exchange.assistantMessage, toolNames);
        prepared.push({ exchange, embedding, toolNames });
    }
    return { exchanges: prepared, summaryText, summaryState };
}
