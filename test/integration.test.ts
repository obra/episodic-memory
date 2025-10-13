import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../src/db.js';
import { indexConversation } from '../src/indexer.js';
import { searchConversations } from '../src/search.js';
import { parseConversationFile } from '../src/parser.js';
import { createTestDb, getFixturePath } from './test-utils.js';
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
      const conversation = parseConversationFile(fixturePath);

      await indexConversation(conversation, { noSummaries: true });

      // Verify data was indexed
      const db = initDatabase();
      const count = db.prepare('SELECT COUNT(*) as count FROM exchanges').get() as { count: number };
      expect(count.count).toBeGreaterThan(0);
      db.close();
    });

    it('should handle multiple conversations', async () => {
      const short = parseConversationFile(getFixturePath('short-conversation.jsonl'));
      const medium = parseConversationFile(getFixturePath('medium-conversation.jsonl'));

      await indexConversation(short, { noSummaries: true });
      await indexConversation(medium, { noSummaries: true });

      const db = initDatabase();
      const count = db.prepare('SELECT COUNT(*) as count FROM exchanges').get() as { count: number };
      expect(count.count).toBeGreaterThan(1);
      db.close();
    });

    it('should store embeddings in vec_exchanges table', async () => {
      const fixturePath = getFixturePath('short-conversation.jsonl');
      const conversation = parseConversationFile(fixturePath);

      await indexConversation(conversation, { noSummaries: true });

      const db = initDatabase();
      const vecCount = db.prepare('SELECT COUNT(*) as count FROM vec_exchanges').get() as { count: number };
      expect(vecCount.count).toBeGreaterThan(0);
      db.close();
    });

    it('should preserve conversation metadata', async () => {
      const fixturePath = getFixturePath('medium-conversation.jsonl');
      const conversation = parseConversationFile(fixturePath);

      await indexConversation(conversation, { noSummaries: true });

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
      const short = parseConversationFile(getFixturePath('short-conversation.jsonl'));
      await indexConversation(short, { noSummaries: true });
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
        expect(results[0].similarity).toBeGreaterThan(0);
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
      const medium = parseConversationFile(getFixturePath('medium-conversation.jsonl'));
      await indexConversation(medium, { noSummaries: true });
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
      const short = parseConversationFile(getFixturePath('short-conversation.jsonl'));
      const medium = parseConversationFile(getFixturePath('medium-conversation.jsonl'));

      await indexConversation(short, { noSummaries: true });
      await indexConversation(medium, { noSummaries: true });
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
      const short = parseConversationFile(getFixturePath('short-conversation.jsonl'));
      await indexConversation(short, { noSummaries: true });
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
});
