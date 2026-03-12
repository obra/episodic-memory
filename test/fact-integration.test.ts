import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../src/db.js';
import { insertFact, getFactsByProject, getActiveFacts, getTopFacts } from '../src/fact-db.js';
import { applyConsolidationResult } from '../src/consolidator.js';
import { suppressConsole } from './test-utils.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

const restoreConsole = suppressConsole();

describe('Fact System Integration', () => {
  let db: Database.Database;
  const testDir = path.join(os.tmpdir(), 'fact-integration-test-' + Date.now());
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

  it('should completely isolate project scopes', () => {
    insertFact(db, { fact: 'Global: use English', category: 'preference', scope_type: 'global', scope_project: null, source_exchange_ids: [], embedding: null });
    insertFact(db, { fact: 'ProjectA: use Riverpod', category: 'decision', scope_type: 'project', scope_project: '/project-a', source_exchange_ids: [], embedding: null });
    insertFact(db, { fact: 'ProjectB: use Bloc', category: 'decision', scope_type: 'project', scope_project: '/project-b', source_exchange_ids: [], embedding: null });

    const factsA = getFactsByProject(db, '/project-a');
    expect(factsA.map(f => f.fact)).toContain('Global: use English');
    expect(factsA.map(f => f.fact)).toContain('ProjectA: use Riverpod');
    expect(factsA.map(f => f.fact)).not.toContain('ProjectB: use Bloc');

    const factsB = getFactsByProject(db, '/project-b');
    expect(factsB.map(f => f.fact)).toContain('Global: use English');
    expect(factsB.map(f => f.fact)).toContain('ProjectB: use Bloc');
    expect(factsB.map(f => f.fact)).not.toContain('ProjectA: use Riverpod');
  });

  it('should handle full DUPLICATE consolidation flow', () => {
    const id1 = insertFact(db, { fact: 'Named export 사용', category: 'preference', scope_type: 'global', scope_project: null, source_exchange_ids: [], embedding: null });
    const id2 = insertFact(db, { fact: 'Named export만 사용한다', category: 'preference', scope_type: 'global', scope_project: null, source_exchange_ids: [], embedding: null });

    const facts = getActiveFacts(db);
    applyConsolidationResult(db, facts.find(f => f.id === id1)!, facts.find(f => f.id === id2)!, {
      relation: 'DUPLICATE', merged_fact: '', reason: 'same content',
    });

    const active = getActiveFacts(db);
    expect(active).toHaveLength(1);
    expect(active[0].consolidated_count).toBe(2);
  });

  it('should handle full CONTRADICTION consolidation flow', () => {
    const id1 = insertFact(db, { fact: 'Zustand 사용', category: 'decision', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });
    const id2 = insertFact(db, { fact: 'React Context 사용으로 변경', category: 'decision', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });

    const facts = getActiveFacts(db);
    applyConsolidationResult(db, facts.find(f => f.id === id1)!, facts.find(f => f.id === id2)!, {
      relation: 'CONTRADICTION', merged_fact: 'React Context로 상태 관리 변경', reason: 'tech stack change',
    });

    const active = getFactsByProject(db, '/proj');
    expect(active).toHaveLength(1);
    expect(active[0].fact).toBe('React Context로 상태 관리 변경');
  });

  it('should handle full EVOLUTION consolidation flow', () => {
    const id1 = insertFact(db, { fact: 'API v1 사용', category: 'knowledge', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });
    const id2 = insertFact(db, { fact: 'API v2로 마이그레이션 완료', category: 'knowledge', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });

    const facts = getActiveFacts(db);
    applyConsolidationResult(db, facts.find(f => f.id === id1)!, facts.find(f => f.id === id2)!, {
      relation: 'EVOLUTION', merged_fact: 'API v2 사용 중 (v1에서 마이그레이션)', reason: 'version upgrade',
    });

    const active = getActiveFacts(db);
    expect(active).toHaveLength(1);
    expect(active[0].fact).toBe('API v2 사용 중 (v1에서 마이그레이션)');
    expect(active[0].consolidated_count).toBe(2);
  });

  it('should return top facts by consolidated_count', () => {
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

  it('should not mix facts across projects even with similar names', () => {
    insertFact(db, { fact: 'Use React', category: 'decision', scope_type: 'project', scope_project: '/web-app', source_exchange_ids: [], embedding: null });
    insertFact(db, { fact: 'Use React Native', category: 'decision', scope_type: 'project', scope_project: '/mobile-app', source_exchange_ids: [], embedding: null });

    const webFacts = getFactsByProject(db, '/web-app');
    expect(webFacts).toHaveLength(1);
    expect(webFacts[0].fact).toBe('Use React');

    const mobileFacts = getFactsByProject(db, '/mobile-app');
    expect(mobileFacts).toHaveLength(1);
    expect(mobileFacts[0].fact).toBe('Use React Native');
  });
});
