import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getArchiveObject } from './archive-ledger.js';
import { getDbPath, getSuperpowersDir } from './paths.js';
import { RcloneTransport } from './rclone-transport.js';
import { reserveCacheCapacity } from './cache-reservation.js';
import { formatConversationAsHTML, formatConversationAsMarkdown } from './show.js';

interface ArchiveShowOptions {
  dbPath?: string;
  cacheDir?: string;
  transport?: Pick<RcloneTransport, 'downloadVerified'>;
  format?: 'markdown' | 'html';
  startLine?: number;
  endLine?: number;
  freeBytes?: (cacheDir: string) => number;
}

export async function showArchivedConversation(identity: string, options: ArchiveShowOptions = {}): Promise<string> {
  const db = new Database(options.dbPath ?? getDbPath(), { readonly: true });
  let record;
  try {
    record = getArchiveObject(db, identity);
  } finally {
    db.close();
  }
  if (!record) throw new Error(`Conversation is not transported: ${identity}`);

  const cacheDir = options.cacheDir ?? path.join(getSuperpowersDir(), 'conversation-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const safeName = record.id.replace(/[^a-zA-Z0-9._-]/g, '_');
  const localPath = path.join(cacheDir, `${safeName}.${randomUUID()}.jsonl`);
  const reservation = await reserveCacheCapacity(cacheDir, localPath, record.sizeBytes, () => {
    if (options.freeBytes) return options.freeBytes(cacheDir);
    const statfs = fs.statfsSync(cacheDir);
    return Number(statfs.bavail) * Number(statfs.bsize);
  });
  if (!reservation.allowed) throw new Error(`Cannot download transcript: ${reservation.reason}`);
  const transport = options.transport ?? new RcloneTransport();
  try {
    await transport.downloadVerified(record.remoteKey, localPath, { bytes: record.sizeBytes, sha256: record.sha256 });
    const jsonl = fs.readFileSync(localPath, 'utf-8');
    return options.format === 'html'
      ? formatConversationAsHTML(jsonl)
      : formatConversationAsMarkdown(jsonl, options.startLine, options.endLine);
  } finally {
    try { fs.unlinkSync(localPath); } catch {}
    reservation.release();
  }
}
