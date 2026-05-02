import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { initDatabase, deleteExchange } from '../src/db.js';

describe('tool_calls FK cascade', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-cascade-test-'));
    dbPath = join(testDir, 'test.db');
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  function insertExchangeRow(db: Database.Database, id: string): void {
    db.prepare(
      `INSERT INTO exchanges (id, project, timestamp, user_message, assistant_message, archive_path, line_start, line_end)
       VALUES (?, 'p', '2026-01-01T00:00:00Z', 'u', 'a', '/x.jsonl', 1, 2)`
    ).run(id);
  }

  function insertToolCall(db: Database.Database, id: string, exchangeId: string): void {
    db.prepare(
      `INSERT INTO tool_calls (id, exchange_id, tool_name, timestamp)
       VALUES (?, ?, 't', '2026-01-01T00:00:00Z')`
    ).run(id, exchangeId);
  }

  function countToolCalls(db: Database.Database, exchangeId: string): number {
    return (db.prepare('SELECT COUNT(*) AS c FROM tool_calls WHERE exchange_id = ?').get(exchangeId) as { c: number }).c;
  }

  it('deleteExchange succeeds when the exchange has tool_calls (regression for #81)', () => {
    const db = initDatabase();
    insertExchangeRow(db, 'ex-with-tools');
    insertToolCall(db, 'tc-a', 'ex-with-tools');
    insertToolCall(db, 'tc-b', 'ex-with-tools');

    // Previously raised SQLITE_CONSTRAINT_FOREIGNKEY; with cascade, it succeeds.
    expect(() => deleteExchange(db, 'ex-with-tools')).not.toThrow();
    expect(countToolCalls(db, 'ex-with-tools')).toBe(0);
    db.close();
  });

  it('deletes dependent tool_calls when an exchange is deleted on a fresh database', () => {
    const db = initDatabase();
    insertExchangeRow(db, 'ex-1');
    insertToolCall(db, 'tc-1', 'ex-1');
    insertToolCall(db, 'tc-2', 'ex-1');

    db.prepare('DELETE FROM exchanges WHERE id = ?').run('ex-1');

    expect(countToolCalls(db, 'ex-1')).toBe(0);
    db.close();
  });

  it('migrates a legacy schema (no cascade, with orphans) to the cascading schema and removes orphans', () => {
    // Build a "legacy" database matching what initDatabase used to create.
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE exchanges (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        user_message TEXT NOT NULL,
        assistant_message TEXT NOT NULL,
        archive_path TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        embedding BLOB,
        last_indexed INTEGER
      );
      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        exchange_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tool_input TEXT,
        tool_result TEXT,
        is_error BOOLEAN DEFAULT 0,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (exchange_id) REFERENCES exchanges(id)
      );
    `);
    legacy.prepare(
      `INSERT INTO exchanges (id, project, timestamp, user_message, assistant_message, archive_path, line_start, line_end)
       VALUES ('ex-real', 'p', '2026-01-01T00:00:00Z', 'u', 'a', '/x.jsonl', 1, 2)`
    ).run();
    legacy.prepare(
      `INSERT INTO tool_calls (id, exchange_id, tool_name, timestamp)
       VALUES ('tc-real', 'ex-real', 't', '2026-01-01T00:00:00Z')`
    ).run();
    // Insert an orphan: tool_call referencing a non-existent exchange.
    // Do this with FK temporarily off to simulate a database that already
    // ended up with orphans before this code shipped.
    legacy.pragma('foreign_keys = OFF');
    legacy.prepare(
      `INSERT INTO tool_calls (id, exchange_id, tool_name, timestamp)
       VALUES ('tc-orphan', 'missing-ex', 't', '2026-01-01T00:00:00Z')`
    ).run();
    legacy.pragma('foreign_keys = ON');
    legacy.close();

    // Open via initDatabase: migration should drop the orphan, preserve the
    // valid row, and apply ON DELETE CASCADE going forward.
    const db = initDatabase();

    const remaining = db.prepare('SELECT id FROM tool_calls ORDER BY id').all() as Array<{ id: string }>;
    expect(remaining.map(r => r.id)).toEqual(['tc-real']);

    // Cascade now works: delete the exchange, the tool_call is removed automatically.
    db.prepare('DELETE FROM exchanges WHERE id = ?').run('ex-real');
    expect(countToolCalls(db, 'ex-real')).toBe(0);
    db.close();
  });
});
