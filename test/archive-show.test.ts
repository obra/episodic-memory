import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { ensureArchiveLedger, putArchiveObject } from '../src/archive-ledger.js';
import { showArchivedConversation } from '../src/archive-show.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('ledger-backed show', () => {
  it('downloads exactly one object, verifies it, formats it, and removes the cache file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-show-')); dirs.push(dir);
    const dbPath = join(dir, 'db.sqlite');
    const cacheDir = join(dir, 'cache');
    const jsonl = JSON.stringify({ type: 'user', uuid: 'u', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'hello' } });
    const db = new Database(dbPath); ensureArchiveLedger(db);
    putArchiveObject(db, { id: 'o', remoteKey: 'remote:archive/o.jsonl', project: 'p',
      sha256: createHash('sha256').update(jsonl).digest('hex'), sizeBytes: Buffer.byteLength(jsonl), lineCount: 1,
      sourceMtimeMs: 1, summaryText: null, summaryState: 'missing', uploadState: 'uploaded', uploadedAtMs: 2, verifiedAtMs: 2 });
    db.close();
    let downloads = 0;
    const transport = { downloadVerified: async (_remote: string, local: string) => { downloads++; writeFileSync(local, jsonl); } };
    const output = await showArchivedConversation('o', { dbPath, cacheDir, transport: transport as any, format: 'markdown' });
    expect(downloads).toBe(1);
    expect(output).toContain('hello');
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it('fails closed for a legacy exchange with no ledger identity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-show-legacy-')); dirs.push(dir);
    const dbPath = join(dir, 'db.sqlite');
    const db = new Database(dbPath); ensureArchiveLedger(db); db.close();
    await expect(showArchivedConversation('/legacy/path.jsonl', { dbPath, cacheDir: join(dir, 'cache'), transport: {} as any })).rejects.toThrow(/not transported/i);
  });

  it('removes a partial cache file when download verification fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-show-bad-')); dirs.push(dir);
    const dbPath = join(dir, 'db.sqlite'); const cacheDir = join(dir, 'cache');
    const db = new Database(dbPath); ensureArchiveLedger(db);
    putArchiveObject(db, { id: 'bad', remoteKey: 'remote:bad.jsonl', project: 'p', sha256: 'c'.repeat(64),
      sizeBytes: 9, lineCount: 1, sourceMtimeMs: 1, summaryText: null, summaryState: 'missing',
      uploadState: 'uploaded', uploadedAtMs: 2, verifiedAtMs: 2 }); db.close();
    const transport = { downloadVerified: async (_remote: string, local: string) => {
      writeFileSync(local, 'partial'); throw new Error('integrity mismatch');
    }};
    await expect(showArchivedConversation('bad', { dbPath, cacheDir, transport: transport as any })).rejects.toThrow(/integrity/);
    expect(readdirSync(cacheDir)).toEqual([]);
  });
});
