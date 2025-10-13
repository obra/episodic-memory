import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, migrateSchema, insertExchange } from './db.js';
import { ConversationExchange } from './types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

describe('database migration', () => {
  const testDir = path.join(os.tmpdir(), 'db-migration-test-' + Date.now());
  const dbPath = path.join(testDir, 'test.db');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('adds last_indexed column to existing database', () => {
    // Create a database with old schema (no last_indexed)
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE exchanges (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        user_message TEXT NOT NULL,
        assistant_message TEXT NOT NULL,
        archive_path TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        embedding BLOB
      )
    `);

    // Verify column doesn't exist
    const columnsBefore = db.prepare(`PRAGMA table_info(exchanges)`).all();
    const hasLastIndexedBefore = columnsBefore.some((col: any) => col.name === 'last_indexed');
    expect(hasLastIndexedBefore).toBe(false);

    db.close();

    // Run migration
    const migratedDb = initDatabase();

    // Verify column now exists
    const columnsAfter = migratedDb.prepare(`PRAGMA table_info(exchanges)`).all();
    const hasLastIndexedAfter = columnsAfter.some((col: any) => col.name === 'last_indexed');
    expect(hasLastIndexedAfter).toBe(true);

    migratedDb.close();
  });

  it('handles existing last_indexed column gracefully', () => {
    // Create database with migration already applied
    const db = initDatabase();

    // Run migration again - should not error
    expect(() => migrateSchema(db)).not.toThrow();

    db.close();
  });
});

describe('insertExchange with last_indexed', () => {
  const testDir = path.join(os.tmpdir(), 'insert-test-' + Date.now());
  const dbPath = path.join(testDir, 'test.db');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('sets last_indexed timestamp when inserting exchange', () => {
    const db = initDatabase();

    const exchange: ConversationExchange = {
      id: 'test-id-1',
      project: 'test-project',
      timestamp: '2024-01-01T00:00:00Z',
      userMessage: 'Hello',
      assistantMessage: 'Hi there!',
      archivePath: '/test/path.jsonl',
      lineStart: 1,
      lineEnd: 2
    };

    const beforeInsert = Date.now();
    // Create proper 384-dimensional embedding
    const embedding = new Array(384).fill(0.1);
    insertExchange(db, exchange, embedding);
    const afterInsert = Date.now();

    // Query the exchange
    const row = db.prepare(`SELECT last_indexed FROM exchanges WHERE id = ?`).get('test-id-1') as any;

    expect(row.last_indexed).toBeDefined();
    expect(row.last_indexed).toBeGreaterThanOrEqual(beforeInsert);
    expect(row.last_indexed).toBeLessThanOrEqual(afterInsert);

    db.close();
  });
});
