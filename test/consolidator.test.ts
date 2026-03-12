import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../src/db.js';
import { insertFact, getActiveFacts } from '../src/fact-db.js';
import { buildConsolidationPrompt, applyConsolidationResult } from '../src/consolidator.js';
import { suppressConsole } from './test-utils.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

const restoreConsole = suppressConsole();

describe('Consolidator', () => {
  describe('buildConsolidationPrompt', () => {
    it('should format two facts for comparison', () => {
      const prompt = buildConsolidationPrompt('Uses Riverpod', 'Chose Riverpod over Bloc');
      expect(prompt).toContain('Uses Riverpod');
      expect(prompt).toContain('Chose Riverpod over Bloc');
      expect(prompt).toContain('Existing fact');
      expect(prompt).toContain('New fact');
    });
  });

  describe('applyConsolidationResult', () => {
    let db: Database.Database;
    const testDir = path.join(os.tmpdir(), 'consolidator-test-' + Date.now());
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

    it('should merge DUPLICATE facts', () => {
      const id1 = insertFact(db, { fact: 'Named export usage', category: 'preference', scope_type: 'global', scope_project: null, source_exchange_ids: [], embedding: null });
      const id2 = insertFact(db, { fact: 'Only use named exports', category: 'preference', scope_type: 'global', scope_project: null, source_exchange_ids: [], embedding: null });

      const facts = getActiveFacts(db);
      applyConsolidationResult(db, facts.find(f => f.id === id1)!, facts.find(f => f.id === id2)!, {
        relation: 'DUPLICATE', merged_fact: '', reason: 'same content',
      });

      const active = getActiveFacts(db);
      expect(active).toHaveLength(1);
      expect(active[0].consolidated_count).toBe(2);
    });

    it('should handle CONTRADICTION - old deactivated, new kept', () => {
      const id1 = insertFact(db, { fact: 'Uses Zustand', category: 'decision', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });
      const id2 = insertFact(db, { fact: 'Switched to React Context', category: 'decision', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });

      const facts = getActiveFacts(db);
      applyConsolidationResult(db, facts.find(f => f.id === id1)!, facts.find(f => f.id === id2)!, {
        relation: 'CONTRADICTION', merged_fact: 'Changed state management to React Context', reason: 'tech stack change',
      });

      const active = getActiveFacts(db);
      expect(active).toHaveLength(1);
      expect(active[0].fact).toBe('Changed state management to React Context');
    });

    it('should handle EVOLUTION - existing updated, new deactivated', () => {
      const id1 = insertFact(db, { fact: 'Uses API v1', category: 'knowledge', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });
      const id2 = insertFact(db, { fact: 'Migrating to API v2', category: 'knowledge', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });

      const facts = getActiveFacts(db);
      applyConsolidationResult(db, facts.find(f => f.id === id1)!, facts.find(f => f.id === id2)!, {
        relation: 'EVOLUTION', merged_fact: 'Now using API v2', reason: 'version upgrade',
      });

      const active = getActiveFacts(db);
      expect(active).toHaveLength(1);
      expect(active[0].fact).toBe('Now using API v2');
      expect(active[0].consolidated_count).toBe(2);
    });

    it('should keep both for INDEPENDENT', () => {
      insertFact(db, { fact: 'Uses React', category: 'decision', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });
      insertFact(db, { fact: 'Uses PostgreSQL', category: 'decision', scope_type: 'project', scope_project: '/proj', source_exchange_ids: [], embedding: null });

      const facts = getActiveFacts(db);
      applyConsolidationResult(db, facts[0], facts[1], {
        relation: 'INDEPENDENT', merged_fact: '', reason: 'unrelated',
      });

      expect(getActiveFacts(db)).toHaveLength(2);
    });
  });
});
