import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../src/db.js';
import { searchConversations, SearchOptions } from '../src/search.js';
import { parseConversationFile } from '../src/parser.js';
import { createTestDb, getFixturePath } from './test-utils.js';
import { indexTestFiles } from './test-indexer.js';
import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Integration Tests', () => {
  let testDbPath: string;
  let cleanup: () => void;

  beforeEach(() => {
    // Create temp directory for test database
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-memory-test-'));
    testDbPath = path.join(tmpDir, 'test.db');

    cleanup = () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    };

    // Override DB path for tests
    process.env.EPISODIC_MEMORY_DB_PATH = testDbPath;
  });

  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_DB_PATH;
    if (cleanup) cleanup();
  });

  describe('Indexing', () => {
    it('should index a conversation successfully', async () => {
      const fixturePath = getFixturePath('short-conversation.jsonl');

      await indexTestFiles([fixturePath]);

      // Verify data was indexed
      const db = initDatabase();
      const count = db.prepare('SELECT COUNT(*) as count FROM exchanges').get() as { count: number };
      expect(count.count).toBeGreaterThan(0);
      db.close();
    });

    it('should handle multiple conversations', async () => {
      const shortPath = getFixturePath('short-conversation.jsonl');
      const longPath = getFixturePath('long-conversation.jsonl');

      await indexTestFiles([shortPath, longPath]);

      const db = initDatabase();
      const count = db.prepare('SELECT COUNT(*) as count FROM exchanges').get() as { count: number };
      expect(count.count).toBeGreaterThan(1);
      db.close();
    });

    it('should store embeddings in vec_exchanges table', async () => {
      const fixturePath = getFixturePath('short-conversation.jsonl');

      await indexTestFiles([fixturePath]);

      const db = initDatabase();
      const vecCount = db.prepare('SELECT COUNT(*) as count FROM vec_exchanges').get() as { count: number };
      expect(vecCount.count).toBeGreaterThan(0);
      db.close();
    });

    it('should preserve conversation metadata', async () => {
      const fixturePath = getFixturePath('long-conversation.jsonl');

      await indexTestFiles([fixturePath]);

      const db = initDatabase();
      const row = db.prepare('SELECT * FROM exchanges LIMIT 1').get() as any;

      expect(row.project).toBeDefined();
      expect(row.timestamp).toBeDefined();
      expect(row.user_message).toBeDefined();
      expect(row.assistant_message).toBeDefined();
      expect(row.archive_path).toBe(fixturePath);
      db.close();
    });
  });

  describe('Vector Search', () => {
    beforeEach(async () => {
      // Index test conversations
      await indexTestFiles([getFixturePath('short-conversation.jsonl')]);
    });

    it('should find conversations by semantic similarity', async () => {
      const results = await searchConversations('Employee class design', {
        limit: 5,
        mode: 'vector'
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return similarity scores', async () => {
      const results = await searchConversations('Python dataclass', {
        limit: 5,
        mode: 'vector'
      });

      if (results.length > 0) {
        expect(results[0].similarity).toBeDefined();
        // Similarity is 1 - distance, where distance can be > 1 for dissimilar items
        // So similarity can be negative (valid for poor matches)
        expect(typeof results[0].similarity).toBe('number');
        expect(results[0].similarity).toBeLessThanOrEqual(1);
      }
    });

    it('should respect limit parameter', async () => {
      const results = await searchConversations('class', {
        limit: 2,
        mode: 'vector'
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Text Search', () => {
    beforeEach(async () => {
      await indexTestFiles([getFixturePath('long-conversation.jsonl')]);
    });

    it('should find exact text matches', async () => {
      const results = await searchConversations('Docker', {
        limit: 10,
        mode: 'text'
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);

      // If Docker appears in the conversation, we should find it
      if (results.length > 0) {
        const hasDocker = results.some(r =>
          r.exchange.userMessage.includes('Docker') ||
          r.exchange.assistantMessage.includes('Docker')
        );
        expect(hasDocker).toBe(true);
      }
    });

    it('should be case-insensitive', async () => {
      const lowerResults = await searchConversations('docker', {
        limit: 10,
        mode: 'text'
      });

      const upperResults = await searchConversations('DOCKER', {
        limit: 10,
        mode: 'text'
      });

      // Should find same results regardless of case
      expect(lowerResults.length).toBe(upperResults.length);
    });
  });

  describe('Combined Search', () => {
    beforeEach(async () => {
      await indexTestFiles([
        getFixturePath('short-conversation.jsonl'),
        getFixturePath('long-conversation.jsonl')
      ]);
    });

    it('should combine vector and text results', async () => {
      const results = await searchConversations('testing', {
        limit: 10,
        mode: 'both'
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should deduplicate combined results', async () => {
      const results = await searchConversations('conversation', {
        limit: 20,
        mode: 'both'
      });

      // Check for duplicate IDs
      const ids = results.map(r => r.exchange.id);
      const uniqueIds = new Set(ids);

      expect(ids.length).toBe(uniqueIds.size); // No duplicates
    });
  });

  describe('Date Filtering', () => {
    beforeEach(async () => {
      await indexTestFiles([getFixturePath('short-conversation.jsonl')]);
    });

    it('should filter by after date', async () => {
      const results = await searchConversations('class', {
        mode: 'vector',
        after: '2025-10-08'
      });

      results.forEach(r => {
        const date = new Date(r.exchange.timestamp);
        const filterDate = new Date('2025-10-08');
        expect(date >= filterDate).toBe(true);
      });
    });

    it('should filter by before date', async () => {
      const results = await searchConversations('class', {
        mode: 'vector',
        before: '2025-10-09'
      });

      results.forEach(r => {
        const date = new Date(r.exchange.timestamp);
        const filterDate = new Date('2025-10-09');
        expect(date <= filterDate).toBe(true);
      });
    });

    it('should handle date range', async () => {
      const results = await searchConversations('class', {
        mode: 'vector',
        after: '2025-10-01',
        before: '2025-10-31'
      });

      results.forEach(r => {
        const date = new Date(r.exchange.timestamp);
        expect(date >= new Date('2025-10-01')).toBe(true);
        expect(date <= new Date('2025-10-31')).toBe(true);
      });
    });
  });

  describe('Metadata Filtering', () => {
    beforeEach(async () => {
      // Index test conversations
      await indexTestFiles([getFixturePath('short-conversation.jsonl')]);

      // Set metadata on indexed exchanges for filtering tests
      const db = initDatabase();

      // Get all exchange IDs
      const rows = db.prepare('SELECT id FROM exchanges').all() as Array<{ id: string }>;
      expect(rows.length).toBeGreaterThan(0);

      // Set metadata on the first exchange
      db.prepare(`
        UPDATE exchanges SET project = ?, session_id = ?, git_branch = ? WHERE id = ?
      `).run('test-project-alpha', 'session-abc-123', 'feat/login', rows[0].id);

      // Set different metadata on remaining exchanges (if any)
      for (let i = 1; i < rows.length; i++) {
        db.prepare(`
          UPDATE exchanges SET project = ?, session_id = ?, git_branch = ? WHERE id = ?
        `).run('test-project-beta', 'session-def-456', 'main', rows[i].id);
      }

      db.close();
    });

    it('should filter by project', async () => {
      const results = await searchConversations('class', {
        mode: 'text',
        project: 'test-project-alpha',
      });

      results.forEach(r => {
        expect(r.exchange.project).toBe('test-project-alpha');
      });
    });

    it('should return empty results for non-matching project', async () => {
      const results = await searchConversations('class', {
        mode: 'text',
        project: 'nonexistent-project',
      });

      expect(results.length).toBe(0);
    });

    it('should filter by git_branch', async () => {
      const results = await searchConversations('class', {
        mode: 'text',
        git_branch: 'main',
      });

      results.forEach(r => {
        expect(r.exchange.gitBranch).toBe('main');
      });
    });

    it('should filter by session_id', async () => {
      const results = await searchConversations('class', {
        mode: 'text',
        session_id: 'session-abc-123',
      });

      results.forEach(r => {
        expect(r.exchange.sessionId).toBe('session-abc-123');
      });
    });

    it('should combine metadata and time filters', async () => {
      const results = await searchConversations('class', {
        mode: 'text',
        project: 'test-project-alpha',
        after: '2025-01-01',
      });

      results.forEach(r => {
        expect(r.exchange.project).toBe('test-project-alpha');
        const date = new Date(r.exchange.timestamp);
        expect(date >= new Date('2025-01-01')).toBe(true);
      });
    });

    it('should reject invalid metadata filter characters', async () => {
      await expect(
        searchConversations('test', { project: "'; DROP TABLE exchanges; --" })
      ).rejects.toThrow('Contains unsupported characters');
    });

    it('should reject overly long metadata filter', async () => {
      const longString = 'a'.repeat(501);
      await expect(
        searchConversations('test', { project: longString })
      ).rejects.toThrow('filter too long');
    });

    it('should work with vector search mode', async () => {
      const results = await searchConversations('class design', {
        mode: 'vector',
        project: 'test-project-alpha',
      });

      results.forEach(r => {
        expect(r.exchange.project).toBe('test-project-alpha');
      });
    });

    it('should return all results when no metadata filter is applied', async () => {
      const filteredResults = await searchConversations('class', {
        mode: 'text',
        project: 'test-project-alpha',
      });
      const allResults = await searchConversations('class', {
        mode: 'text',
      });

      // Without filter should return >= filtered count
      expect(allResults.length).toBeGreaterThanOrEqual(filteredResults.length);
    });
  });
});
