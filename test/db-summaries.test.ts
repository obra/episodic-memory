import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { suppressConsole } from './test-utils.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

// Suppress console output for clean test runs
const restoreConsole = suppressConsole();

// Restore console after all tests
afterAll(() => {
  restoreConsole();
});

// Import the functions and types we're going to create
// These will fail until we implement them
import type { SessionSummary } from '../src/session-summary-types.js';
import {
  initDatabase,
  insertSessionSummary,
  searchSummaries,
  getSummaryBySessionId
} from '../src/db.js';

describe('session_summaries table', () => {
  const testDir = path.join(os.tmpdir(), 'db-summary-test-' + Date.now());
  const dbPath = path.join(testDir, 'test.db');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('creates session_summaries table on init', () => {
    const db = initDatabase();

    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries'
    `).all();

    expect(tables).toHaveLength(1);
    db.close();
  });

  it('creates vec_summaries virtual table on init', () => {
    const db = initDatabase();

    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='vec_summaries'
    `).all();

    expect(tables).toHaveLength(1);
    db.close();
  });

  it('creates indexes for session_summaries', () => {
    const db = initDatabase();

    const indexes = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='session_summaries'
    `).all() as { name: string }[];

    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_summary_project');
    expect(indexNames).toContain('idx_summary_timestamp');

    db.close();
  });

  it('session_summaries has correct columns', () => {
    const db = initDatabase();

    const columns = db.prepare(`PRAGMA table_info(session_summaries)`).all() as any[];
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('session_id');
    expect(columnNames).toContain('project');
    expect(columnNames).toContain('timestamp');
    expect(columnNames).toContain('duration_minutes');
    expect(columnNames).toContain('one_liner');
    expect(columnNames).toContain('detailed');
    expect(columnNames).toContain('decisions');
    expect(columnNames).toContain('files_modified');
    expect(columnNames).toContain('work_items');
    expect(columnNames).toContain('tools_used');
    expect(columnNames).toContain('outcomes');
    expect(columnNames).toContain('next_steps');
    expect(columnNames).toContain('tags');

    db.close();
  });
});

describe('insertSessionSummary', () => {
  const testDir = path.join(os.tmpdir(), 'insert-summary-test-' + Date.now());
  const dbPath = path.join(testDir, 'test.db');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('stores summary correctly', () => {
    const db = initDatabase();

    const summary: SessionSummary = {
      id: 'summary-1',
      sessionId: 'session-1',
      project: 'test-project',
      timestamp: '2024-01-01T00:00:00Z',
      durationMinutes: 30,
      summary: {
        oneLiner: 'Test summary',
        detailed: 'Detailed test summary'
      },
      decisions: [{ description: 'Use TypeScript', rationale: 'Type safety' }],
      filesModified: [{ path: '/src/index.ts', action: 'modified' }],
      workItems: [{ id: 'feat-001', action: 'completed' }],
      toolsUsed: [{ name: 'Read', count: 5 }],
      outcomes: [{ description: 'Feature implemented', status: 'success' }],
      nextSteps: [{ description: 'Add tests', priority: 'high' }],
      tags: ['typescript', 'testing']
    };

    // 384-dimensional embedding for sqlite-vec
    const embedding = new Array(384).fill(0.1);
    insertSessionSummary(db, summary, embedding);

    // Verify stored correctly
    const row = db.prepare(`SELECT * FROM session_summaries WHERE id = ?`).get('summary-1') as any;

    expect(row.session_id).toBe('session-1');
    expect(row.project).toBe('test-project');
    expect(row.one_liner).toBe('Test summary');
    expect(row.detailed).toBe('Detailed test summary');
    expect(row.duration_minutes).toBe(30);

    // Verify JSON fields
    expect(JSON.parse(row.decisions)).toEqual([{ description: 'Use TypeScript', rationale: 'Type safety' }]);
    expect(JSON.parse(row.tags)).toEqual(['typescript', 'testing']);

    db.close();
  });

  it('replaces existing summary with same session_id', () => {
    const db = initDatabase();

    const summary1: SessionSummary = {
      id: 'summary-1',
      sessionId: 'session-1',
      project: 'test-project',
      timestamp: '2024-01-01T00:00:00Z',
      durationMinutes: 30,
      summary: { oneLiner: 'First', detailed: '' },
      decisions: [],
      filesModified: [],
      workItems: [],
      toolsUsed: [],
      outcomes: [],
      nextSteps: [],
      tags: []
    };

    const summary2: SessionSummary = {
      id: 'summary-2',
      sessionId: 'session-1', // Same session
      project: 'test-project',
      timestamp: '2024-01-01T01:00:00Z',
      durationMinutes: 60,
      summary: { oneLiner: 'Second', detailed: 'Updated' },
      decisions: [],
      filesModified: [],
      workItems: [],
      toolsUsed: [],
      outcomes: [],
      nextSteps: [],
      tags: []
    };

    const embedding = new Array(384).fill(0.1);
    insertSessionSummary(db, summary1, embedding);
    insertSessionSummary(db, summary2, embedding);

    // Should only have one record
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM session_summaries`).get() as any;
    expect(count.cnt).toBe(1);

    // Should be the second summary
    const row = db.prepare(`SELECT one_liner FROM session_summaries WHERE session_id = ?`).get('session-1') as any;
    expect(row.one_liner).toBe('Second');

    db.close();
  });

  it('stores embedding in vec_summaries table', () => {
    const db = initDatabase();

    const summary: SessionSummary = {
      id: 'summary-1',
      sessionId: 'session-1',
      project: 'test-project',
      timestamp: '2024-01-01T00:00:00Z',
      durationMinutes: 30,
      summary: { oneLiner: 'Test', detailed: '' },
      decisions: [],
      filesModified: [],
      workItems: [],
      toolsUsed: [],
      outcomes: [],
      nextSteps: [],
      tags: []
    };

    const embedding = new Array(384).fill(0.1);
    insertSessionSummary(db, summary, embedding);

    // Verify vector stored
    const vecCount = db.prepare(`SELECT COUNT(*) as cnt FROM vec_summaries`).get() as any;
    expect(vecCount.cnt).toBe(1);

    db.close();
  });
});

describe('searchSummaries', () => {
  const testDir = path.join(os.tmpdir(), 'search-summary-test-' + Date.now());
  const dbPath = path.join(testDir, 'test.db');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('returns empty array for empty database', () => {
    const db = initDatabase();

    const embedding = new Array(384).fill(0.1);
    const results = searchSummaries(db, embedding);

    expect(results).toEqual([]);

    db.close();
  });

  it('returns results sorted by similarity', () => {
    const db = initDatabase();

    // Insert summaries with different embeddings
    const summary1: SessionSummary = {
      id: 'summary-1',
      sessionId: 'session-1',
      project: 'project-a',
      timestamp: '2024-01-01T00:00:00Z',
      durationMinutes: 30,
      summary: { oneLiner: 'First summary', detailed: '' },
      decisions: [],
      filesModified: [],
      workItems: [],
      toolsUsed: [],
      outcomes: [],
      nextSteps: [],
      tags: ['tag1']
    };

    const summary2: SessionSummary = {
      id: 'summary-2',
      sessionId: 'session-2',
      project: 'project-b',
      timestamp: '2024-01-02T00:00:00Z',
      durationMinutes: 60,
      summary: { oneLiner: 'Second summary', detailed: '' },
      decisions: [],
      filesModified: [],
      workItems: [],
      toolsUsed: [],
      outcomes: [],
      nextSteps: [],
      tags: ['tag2']
    };

    // Different embeddings
    const embedding1 = new Array(384).fill(0.1);
    const embedding2 = new Array(384).fill(0.5);

    insertSessionSummary(db, summary1, embedding1);
    insertSessionSummary(db, summary2, embedding2);

    // Search with embedding similar to first
    const searchEmbedding = new Array(384).fill(0.1);
    const results = searchSummaries(db, searchEmbedding, 10);

    expect(results.length).toBe(2);
    // First result should be most similar
    expect(results[0].id).toBe('summary-1');

    db.close();
  });

  it('respects limit parameter', () => {
    const db = initDatabase();

    // Insert 5 summaries
    for (let i = 1; i <= 5; i++) {
      const summary: SessionSummary = {
        id: `summary-${i}`,
        sessionId: `session-${i}`,
        project: 'test-project',
        timestamp: `2024-01-0${i}T00:00:00Z`,
        durationMinutes: i * 10,
        summary: { oneLiner: `Summary ${i}`, detailed: '' },
        decisions: [],
        filesModified: [],
        workItems: [],
        toolsUsed: [],
        outcomes: [],
        nextSteps: [],
        tags: []
      };
      const embedding = new Array(384).fill(0.1 * i);
      insertSessionSummary(db, summary, embedding);
    }

    const searchEmbedding = new Array(384).fill(0.1);
    const results = searchSummaries(db, searchEmbedding, 3);

    expect(results.length).toBe(3);

    db.close();
  });

  it('correctly parses JSON fields in results', () => {
    const db = initDatabase();

    const summary: SessionSummary = {
      id: 'summary-1',
      sessionId: 'session-1',
      project: 'test-project',
      timestamp: '2024-01-01T00:00:00Z',
      durationMinutes: 30,
      summary: { oneLiner: 'Test', detailed: 'Detailed test' },
      decisions: [{ description: 'Decision 1', rationale: 'Reason 1' }],
      filesModified: [{ path: '/src/file.ts', action: 'created' }],
      workItems: [{ id: 'feat-001', action: 'started' }],
      toolsUsed: [{ name: 'Read', count: 3 }],
      outcomes: [{ description: 'Success', status: 'success' }],
      nextSteps: [{ description: 'Next step', priority: 'medium' }],
      tags: ['tag1', 'tag2']
    };

    const embedding = new Array(384).fill(0.1);
    insertSessionSummary(db, summary, embedding);

    const results = searchSummaries(db, embedding, 10);

    expect(results[0].decisions).toEqual([{ description: 'Decision 1', rationale: 'Reason 1' }]);
    expect(results[0].filesModified).toEqual([{ path: '/src/file.ts', action: 'created' }]);
    expect(results[0].workItems).toEqual([{ id: 'feat-001', action: 'started' }]);
    expect(results[0].toolsUsed).toEqual([{ name: 'Read', count: 3 }]);
    expect(results[0].outcomes).toEqual([{ description: 'Success', status: 'success' }]);
    expect(results[0].nextSteps).toEqual([{ description: 'Next step', priority: 'medium' }]);
    expect(results[0].tags).toEqual(['tag1', 'tag2']);

    db.close();
  });
});

describe('getSummaryBySessionId', () => {
  const testDir = path.join(os.tmpdir(), 'get-summary-test-' + Date.now());
  const dbPath = path.join(testDir, 'test.db');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('returns null for non-existent session', () => {
    const db = initDatabase();

    const result = getSummaryBySessionId(db, 'non-existent');
    expect(result).toBeNull();

    db.close();
  });

  it('returns summary for existing session', () => {
    const db = initDatabase();

    const summary: SessionSummary = {
      id: 'summary-1',
      sessionId: 'session-123',
      project: 'test-project',
      timestamp: '2024-01-01T00:00:00Z',
      durationMinutes: 30,
      summary: { oneLiner: 'Test summary', detailed: 'Detailed' },
      decisions: [],
      filesModified: [],
      workItems: [],
      toolsUsed: [],
      outcomes: [],
      nextSteps: [],
      tags: []
    };

    const embedding = new Array(384).fill(0.1);
    insertSessionSummary(db, summary, embedding);

    const result = getSummaryBySessionId(db, 'session-123');

    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe('session-123');
    expect(result?.summary.oneLiner).toBe('Test summary');

    db.close();
  });
});
