import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../src/db.js';
import {
  insertFact,
  getActiveFacts,
  getFactsByProject,
  updateFact,
  deactivateFact,
  insertRevision,
  getRevisions,
  getTopFacts,
  getNewFactsSince,
} from '../src/fact-db.js';
import { suppressConsole } from './test-utils.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

const restoreConsole = suppressConsole();

describe('Facts DB Schema', () => {
  let db: Database.Database;
  const testDir = path.join(os.tmpdir(), 'fact-schema-test-' + Date.now());
  const dbPath = path.join(testDir, 'test.db');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TEST_DB_PATH = dbPath;
    db = initDatabase();
  });

  afterEach(() => {
    db.close();
    delete process.env.TEST_DB_PATH;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should create facts table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='facts'").all();
    expect(tables).toHaveLength(1);
  });

  it('should create fact_revisions table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fact_revisions'").all();
    expect(tables).toHaveLength(1);
  });

  it('should create vec_facts virtual table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_facts'").all();
    expect(tables).toHaveLength(1);
  });

  it('should have correct facts columns', () => {
    const columns = db.prepare("PRAGMA table_info(facts)").all() as Array<{ name: string }>;
    const colNames = columns.map(c => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('fact');
    expect(colNames).toContain('category');
    expect(colNames).toContain('scope_type');
    expect(colNames).toContain('scope_project');
    expect(colNames).toContain('source_exchange_ids');
    expect(colNames).toContain('embedding');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
    expect(colNames).toContain('consolidated_count');
    expect(colNames).toContain('is_active');
  });
});

describe('Fact CRUD', () => {
  let db: Database.Database;
  const testDir = path.join(os.tmpdir(), 'fact-crud-test-' + Date.now());
  const dbPath = path.join(testDir, 'test.db');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TEST_DB_PATH = dbPath;
    db = initDatabase();
  });

  afterEach(() => {
    db.close();
    delete process.env.TEST_DB_PATH;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should insert and retrieve a fact', () => {
    const id = insertFact(db, {
      fact: 'Riverpod을 상태 관리에 사용한다',
      category: 'decision',
      scope_type: 'project',
      scope_project: '/path/to/project',
      source_exchange_ids: ['ex1', 'ex2'],
      embedding: null,
    });

    const facts = getFactsByProject(db, '/path/to/project');
    expect(facts).toHaveLength(1);
    expect(facts[0].fact).toBe('Riverpod을 상태 관리에 사용한다');
    expect(facts[0].category).toBe('decision');
    expect(facts[0].is_active).toBe(true);
    expect(facts[0].source_exchange_ids).toEqual(['ex1', 'ex2']);
  });

  it('should filter by scope - project isolation', () => {
    insertFact(db, { fact: 'Global fact', category: 'preference', scope_type: 'global', scope_project: null, source_exchange_ids: [], embedding: null });
    insertFact(db, { fact: 'Project A fact', category: 'decision', scope_type: 'project', scope_project: '/project-a', source_exchange_ids: [], embedding: null });
    insertFact(db, { fact: 'Project B fact', category: 'decision', scope_type: 'project', scope_project: '/project-b', source_exchange_ids: [], embedding: null });

    const factsA = getFactsByProject(db, '/project-a');
    expect(factsA).toHaveLength(2);
    expect(factsA.map(f => f.fact)).toContain('Global fact');
    expect(factsA.map(f => f.fact)).toContain('Project A fact');
    expect(factsA.map(f => f.fact)).not.toContain('Project B fact');
  });

  it('should deactivate a fact', () => {
    insertFact(db, { fact: 'Old decision', category: 'decision', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });

    const allFacts = getActiveFacts(db);
    expect(allFacts).toHaveLength(1);
    deactivateFact(db, allFacts[0].id);
    expect(getActiveFacts(db)).toHaveLength(0);
  });

  it('should insert and retrieve revisions', () => {
    const factId = insertFact(db, { fact: 'Original fact', category: 'decision', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });

    insertRevision(db, { fact_id: factId, previous_fact: 'Original fact', new_fact: 'Updated fact', reason: 'Evolution', source_exchange_id: 'ex3' });

    const revisions = getRevisions(db, factId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].previous_fact).toBe('Original fact');
    expect(revisions[0].new_fact).toBe('Updated fact');
  });

  it('should update fact text and increment consolidated_count', () => {
    const id = insertFact(db, { fact: 'V1 fact', category: 'decision', scope_type: 'project', scope_project: '/proj', source_exchange_ids: ['ex1'], embedding: null });

    updateFact(db, id, { fact: 'V2 fact', consolidated_count_increment: true });
    const facts = getActiveFacts(db);
    expect(facts[0].fact).toBe('V2 fact');
    expect(facts[0].consolidated_count).toBe(2);
  });

  it('should return top facts ordered by consolidated_count', () => {
    for (let i = 0; i < 15; i++) {
      const id = insertFact(db, { fact: `Fact ${i}`, category: 'knowledge', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });
      if (i < 5) {
        db.prepare('UPDATE facts SET consolidated_count = ? WHERE id = ?').run(i + 2, id);
      }
    }

    const top = getTopFacts(db, '/proj', 10);
    expect(top).toHaveLength(10);
    expect(top[0].consolidated_count).toBeGreaterThanOrEqual(top[9].consolidated_count);
  });

  it('should get new facts since a timestamp', () => {
    const past = new Date(Date.now() - 10000).toISOString();
    insertFact(db, { fact: 'New fact', category: 'decision', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });

    const newFacts = getNewFactsSince(db, '/proj', past);
    expect(newFacts).toHaveLength(1);
    expect(newFacts[0].fact).toBe('New fact');
  });
});
