import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getIndexStats } from '../src/stats.js';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

describe('stats command', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-stats-test-'));
    dbPath = join(testDir, 'test.db');
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should return basic statistics for empty database', async () => {
    const stats = await getIndexStats(dbPath);

    expect(stats.totalConversations).toBe(0);
    expect(stats.conversationsWithSummaries).toBe(0);
    expect(stats.conversationsWithoutSummaries).toBe(0);
    expect(stats.totalExchanges).toBe(0);
  });

  it('should count conversations and exchanges', async () => {
    // Create and initialize database
    const db = new Database(dbPath);
    sqliteVec.load(db);

    db.exec(`
      CREATE TABLE exchanges (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        user_message TEXT NOT NULL,
        assistant_message TEXT NOT NULL,
        archive_path TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL
      )
    `);

    // Insert test data
    db.prepare(`
      INSERT INTO exchanges (id, project, timestamp, user_message, assistant_message, archive_path, line_start, line_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('id-1', 'test-project', '2025-10-01T12:00:00Z', 'Hello', 'Hi there', join(testDir, 'test.jsonl'), 1, 2);

    db.close();

    const stats = await getIndexStats(dbPath);

    expect(stats.totalConversations).toBe(1);
    expect(stats.totalExchanges).toBe(1);
    expect(stats.conversationsWithoutSummaries).toBe(1);
  });

  it('should track date range', async () => {
    const db = new Database(dbPath);
    sqliteVec.load(db);

    db.exec(`
      CREATE TABLE exchanges (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        user_message TEXT NOT NULL,
        assistant_message TEXT NOT NULL,
        archive_path TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL
      )
    `);

    db.prepare(`
      INSERT INTO exchanges (id, project, timestamp, user_message, assistant_message, archive_path, line_start, line_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('id-1', 'test-project', '2025-10-01T12:00:00Z', 'Hello', 'Hi', join(testDir, 'test.jsonl'), 1, 2);

    db.close();

    const stats = await getIndexStats(dbPath);

    expect(stats.dateRange).toBeDefined();
    expect(stats.dateRange?.earliest).toContain('2025-10-01');
    expect(stats.dateRange?.latest).toContain('2025-10-01');
  });

  it('should count projects', async () => {
    const db = new Database(dbPath);
    sqliteVec.load(db);

    db.exec(`
      CREATE TABLE exchanges (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        user_message TEXT NOT NULL,
        assistant_message TEXT NOT NULL,
        archive_path TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL
      )
    `);

    // Insert conversations from different projects
    db.prepare(`
      INSERT INTO exchanges (id, project, timestamp, user_message, assistant_message, archive_path, line_start, line_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('id-1', 'project-a', '2025-10-01T12:00:00Z', 'Hello', 'Hi', join(testDir, 'test1.jsonl'), 1, 2);

    db.prepare(`
      INSERT INTO exchanges (id, project, timestamp, user_message, assistant_message, archive_path, line_start, line_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('id-2', 'project-b', '2025-10-01T12:00:00Z', 'Hello', 'Hi', join(testDir, 'test2.jsonl'), 1, 2);

    db.close();

    const stats = await getIndexStats(dbPath);

    expect(stats.projectCount).toBe(2);
    expect(stats.topProjects).toBeDefined();
    expect(stats.topProjects?.length).toBe(2);
  });
});
