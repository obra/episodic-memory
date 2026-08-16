import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getArchiveObject } from './archive-ledger.js';
import { getDbPath, getSuperpowersDir } from './paths.js';
import { checkCacheCapacity, RcloneTransport } from './rclone-transport.js';
import { formatConversationAsHTML, formatConversationAsMarkdown } from './show.js';
export async function showArchivedConversation(identity, options = {}) {
    const db = new Database(options.dbPath ?? getDbPath(), { readonly: true });
    let record;
    try {
        record = getArchiveObject(db, identity);
    }
    finally {
        db.close();
    }
    if (!record)
        throw new Error(`Conversation is not transported: ${identity}`);
    const cacheDir = options.cacheDir ?? path.join(getSuperpowersDir(), 'conversation-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const statfs = fs.statfsSync(cacheDir);
    const capacity = checkCacheCapacity(cacheSize(cacheDir), record.sizeBytes, Number(statfs.bavail) * Number(statfs.bsize));
    if (!capacity.allowed)
        throw new Error(`Cannot download transcript: ${capacity.reason}`);
    const safeName = record.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    const localPath = path.join(cacheDir, `${safeName}.${randomUUID()}.jsonl`);
    const transport = options.transport ?? new RcloneTransport();
    try {
        await transport.downloadVerified(record.remoteKey, localPath, { bytes: record.sizeBytes, sha256: record.sha256 });
        const jsonl = fs.readFileSync(localPath, 'utf-8');
        return options.format === 'html'
            ? formatConversationAsHTML(jsonl)
            : formatConversationAsMarkdown(jsonl, options.startLine, options.endLine);
    }
    finally {
        try {
            fs.unlinkSync(localPath);
        }
        catch { }
    }
}
function cacheSize(dir) {
    let bytes = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const item = path.join(dir, entry.name);
        bytes += entry.isDirectory() ? cacheSize(item) : fs.statSync(item).size;
    }
    return bytes;
}
