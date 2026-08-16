import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { ensureArchiveLedger, getArchiveObject, putArchiveObject } from '../src/archive-ledger.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('archive_objects ledger', () => {
  it('round-trips the persisted transport and query metadata shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-ledger-')); dirs.push(dir);
    const db = new Database(join(dir, 'db.sqlite'));
    ensureArchiveLedger(db);
    putArchiveObject(db, {
      id: 'obj-1', remoteKey: 'remote:archive/p/a.jsonl', project: 'p', sha256: 'a'.repeat(64),
      sizeBytes: 42, lineCount: 3, sourceMtimeMs: 123, summaryText: 'summary',
      summaryState: 'ready', uploadState: 'uploaded', uploadedAtMs: 456, verifiedAtMs: 457,
    });
    expect(getArchiveObject(db, 'obj-1')).toMatchObject({
      remoteKey: 'remote:archive/p/a.jsonl', sizeBytes: 42, lineCount: 3,
      summaryText: 'summary', summaryState: 'ready', uploadState: 'uploaded',
    });
    db.close();
  });
});
