import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { formatResults } from '../src/search.js';
import { getIndexStats } from '../src/stats.js';
import { ensureArchiveLedger, putArchiveObject } from '../src/archive-ledger.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('SQLite-only search and stats', () => {
  it('formats a result whose archive path does not exist without filesystem access', async () => {
    const output = await formatResults([{
      exchange: {
        id: 'x', project: 'p', timestamp: '2026-01-01T00:00:00Z', userMessage: 'hello',
        assistantMessage: 'world', archivePath: '/definitely/missing/a.jsonl', lineStart: 1, lineEnd: 2,
        archiveSizeBytes: 2048, archiveLineCount: 8,
      }, similarity: 1, snippet: 'hello', summary: 'stored summary',
    }]);
    expect(output).toContain('(2KB, 8 lines)');
  });

  it('counts summary state from archive_objects even when remote paths are nonexistent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-stats-isolation-')); dirs.push(dir);
    const dbPath = join(dir, 'db.sqlite');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE exchanges (id TEXT PRIMARY KEY, project TEXT NOT NULL, timestamp TEXT NOT NULL,
      user_message TEXT NOT NULL, assistant_message TEXT NOT NULL, archive_path TEXT NOT NULL,
      line_start INTEGER NOT NULL, line_end INTEGER NOT NULL, archive_object_id TEXT)`);
    ensureArchiveLedger(db);
    putArchiveObject(db, { id: 'o', remoteKey: 'remote:missing/a.jsonl', project: 'p', sha256: 'b'.repeat(64),
      sizeBytes: 10, lineCount: 1, sourceMtimeMs: 1, summaryText: 'yes', summaryState: 'ready',
      uploadState: 'uploaded', uploadedAtMs: 2, verifiedAtMs: 2 });
    db.prepare(`INSERT INTO exchanges VALUES (?,?,?,?,?,?,?,?,?)`).run('x','p','2026-01-01','u','a','remote:missing/a.jsonl',1,1,'o');
    db.close();
    const stats = await getIndexStats(dbPath);
    expect(stats.conversationsWithSummaries).toBe(1);
  });
});
