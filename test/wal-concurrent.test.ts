import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('WAL mode concurrent access', () => {
  it('allows concurrent reads while writing (reader sees committed state only)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-wal-test-'));
    const dbPath = path.join(tmpDir, 'test.db');

    try {
      // Writer with all 3 PRAGMAs applied
      const writer = new Database(dbPath);
      writer.pragma('journal_mode = WAL');
      writer.pragma('busy_timeout = 5000');
      writer.pragma('foreign_keys = ON');
      writer.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, x TEXT)');

      // Reader opens the same DB (WAL allows this without blocking)
      const reader = new Database(dbPath, { readonly: true });

      // Begin a write transaction but don't commit yet
      writer.exec('BEGIN');
      writer.prepare('INSERT INTO t (x) VALUES (?)').run('uncommitted');

      // Reader should see 0 rows (uncommitted write not visible)
      const rowsDuring = reader.prepare('SELECT COUNT(*) as n FROM t').get() as { n: number };
      expect(rowsDuring.n).toBe(0);

      // Commit and verify reader now sees the row
      writer.exec('COMMIT');
      const rowsAfter = reader.prepare('SELECT COUNT(*) as n FROM t').get() as { n: number };
      expect(rowsAfter.n).toBe(1);

      writer.close();
      reader.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('busy_timeout pragma is set (returns 5000)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-wal-test-'));
    const dbPath = path.join(tmpDir, 'test.db');

    try {
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 5000');
      db.pragma('foreign_keys = ON');

      const timeout = db.pragma('busy_timeout', { simple: true }) as number;
      expect(timeout).toBe(5000);

      const fkEnabled = db.pragma('foreign_keys', { simple: true }) as number;
      expect(fkEnabled).toBe(1);

      db.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
