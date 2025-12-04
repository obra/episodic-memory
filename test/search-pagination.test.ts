import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../src/db.js';
import { searchConversations, searchMultipleConcepts, formatResults, formatMultiConceptResults } from '../src/search.js';
import { getFixturePath } from './test-utils.js';
import { indexTestFiles } from './test-indexer.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Search Pagination', () => {
  let testDbPath: string;
  let cleanup: () => void;

  beforeEach(async () => {
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

    // Index test conversations
    await indexTestFiles([
      getFixturePath('short-conversation.jsonl'),
      getFixturePath('long-conversation.jsonl')
    ]);
  });

  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_DB_PATH;
    if (cleanup) cleanup();
  });

  describe('Single-concept search pagination', () => {
    it('should return pagination metadata with default offset', async () => {
      const result = await searchConversations('class', {
        mode: 'vector',
        limit: 5
      });

      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
      expect(result.pagination).toBeDefined();
      expect(result.pagination.offset).toBe(0);
      expect(result.pagination.limit).toBe(5);
      expect(result.pagination.total).toBeGreaterThanOrEqual(result.results.length);
      expect(typeof result.pagination.hasMore).toBe('boolean');
    });

    it('should respect offset parameter', async () => {
      const firstPage = await searchConversations('class', {
        mode: 'vector',
        limit: 2,
        offset: 0
      });

      const secondPage = await searchConversations('class', {
        mode: 'vector',
        limit: 2,
        offset: 2
      });

      expect(firstPage.pagination.offset).toBe(0);
      expect(secondPage.pagination.offset).toBe(2);

      // If there are at least 4 results, the IDs should be different
      if (firstPage.pagination.total >= 4) {
        const firstIds = new Set(firstPage.results.map(r => r.exchange.id));
        const secondIds = new Set(secondPage.results.map(r => r.exchange.id));

        // No overlap between pages
        for (const id of secondIds) {
          expect(firstIds.has(id)).toBe(false);
        }
      }
    });

    it('should set hasMore=true when more results exist', async () => {
      const result = await searchConversations('class', {
        mode: 'vector',
        limit: 1,
        offset: 0
      });

      if (result.pagination.total > 1) {
        expect(result.pagination.hasMore).toBe(true);
        expect(result.pagination.nextOffset).toBe(1);
      }
    });

    it('should set hasMore=false on last page', async () => {
      const result = await searchConversations('class', {
        mode: 'vector',
        limit: 100,
        offset: 0
      });

      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.nextOffset).toBeUndefined();
    });

    it('should return empty results for offset beyond total', async () => {
      const result = await searchConversations('class', {
        mode: 'vector',
        limit: 10,
        offset: 1000
      });

      expect(result.results.length).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.offset).toBe(1000);
    });

    it('should work with text search mode', async () => {
      const result = await searchConversations('class', {
        mode: 'text',
        limit: 3,
        offset: 0
      });

      expect(result.pagination).toBeDefined();
      expect(result.pagination.limit).toBe(3);
      expect(result.results.length).toBeLessThanOrEqual(3);
    });

    it('should work with both search mode', async () => {
      const result = await searchConversations('class', {
        mode: 'both',
        limit: 5,
        offset: 0
      });

      expect(result.pagination).toBeDefined();
      expect(result.pagination.limit).toBe(5);
      expect(result.results.length).toBeLessThanOrEqual(5);
    });

    it('should handle pagination with date filters', async () => {
      const result = await searchConversations('class', {
        mode: 'vector',
        limit: 5,
        offset: 0,
        after: '2025-10-01',
        before: '2025-10-31'
      });

      expect(result.pagination).toBeDefined();
      expect(result.pagination.offset).toBe(0);
      expect(result.pagination.limit).toBe(5);
    });
  });

  describe('Multi-concept search pagination', () => {
    it('should return pagination metadata for multi-concept search', async () => {
      const result = await searchMultipleConcepts(
        ['class', 'design'],
        { limit: 5, offset: 0 }
      );

      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
      expect(result.pagination).toBeDefined();
      expect(result.pagination.offset).toBe(0);
      expect(result.pagination.limit).toBe(5);
      expect(result.pagination.total).toBeGreaterThanOrEqual(result.results.length);
    });

    it('should respect offset in multi-concept search', async () => {
      const firstPage = await searchMultipleConcepts(
        ['class', 'design'],
        { limit: 1, offset: 0 }
      );

      const secondPage = await searchMultipleConcepts(
        ['class', 'design'],
        { limit: 1, offset: 1 }
      );

      expect(firstPage.pagination.offset).toBe(0);
      expect(secondPage.pagination.offset).toBe(1);

      // If there are at least 2 results, they should be different
      if (firstPage.pagination.total >= 2 && firstPage.results.length > 0 && secondPage.results.length > 0) {
        expect(firstPage.results[0].exchange.id).not.toBe(secondPage.results[0].exchange.id);
      }
    });

    it('should set hasMore correctly for multi-concept search', async () => {
      const result = await searchMultipleConcepts(
        ['class', 'design'],
        { limit: 100, offset: 0 }
      );

      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.nextOffset).toBeUndefined();
    });

    it('should return empty results with pagination for no matches', async () => {
      const result = await searchMultipleConcepts(
        [],
        { limit: 10, offset: 0 }
      );

      expect(result.results.length).toBe(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
    });
  });

  describe('Format functions with pagination', () => {
    it('should include pagination info in markdown format', async () => {
      const result = await searchConversations('class', {
        mode: 'vector',
        limit: 3,
        offset: 0
      });

      const formatted = await formatResults(
        result.results,
        result.pagination,
        'markdown'
      );

      expect(formatted).toContain('Search Results');
      expect(formatted).toContain('Showing');
      expect(formatted).toContain(`of ${result.pagination.total}`);

      if (result.pagination.hasMore) {
        expect(formatted).toContain('More results available');
        expect(formatted).toContain(`offset: ${result.pagination.nextOffset}`);
      }
    });

    it('should include pagination in JSON format', async () => {
      const result = await searchConversations('class', {
        mode: 'vector',
        limit: 3,
        offset: 0
      });

      const formatted = await formatResults(
        result.results,
        result.pagination,
        'json'
      );

      const parsed = JSON.parse(formatted);
      expect(parsed.pagination).toBeDefined();
      expect(parsed.pagination.total).toBe(result.pagination.total);
      expect(parsed.pagination.limit).toBe(3);
      expect(parsed.pagination.offset).toBe(0);
      expect(parsed.pagination.hasMore).toBe(result.pagination.hasMore);
    });

    it('should include pagination in multi-concept markdown format', async () => {
      const result = await searchMultipleConcepts(
        ['class', 'design'],
        { limit: 2, offset: 0 }
      );

      const formatted = await formatMultiConceptResults(
        result.results,
        ['class', 'design'],
        result.pagination,
        'markdown'
      );

      expect(formatted).toContain('Multi-Concept Search Results');
      expect(formatted).toContain('Showing');
      expect(formatted).toContain(`of ${result.pagination.total}`);
    });

    it('should include pagination in multi-concept JSON format', async () => {
      const result = await searchMultipleConcepts(
        ['class', 'design'],
        { limit: 2, offset: 0 }
      );

      const formatted = await formatMultiConceptResults(
        result.results,
        ['class', 'design'],
        result.pagination,
        'json'
      );

      const parsed = JSON.parse(formatted);
      expect(parsed.pagination).toBeDefined();
      expect(parsed.pagination.limit).toBe(2);
      expect(parsed.concepts).toEqual(['class', 'design']);
    });

    it('should handle empty results with pagination metadata', async () => {
      const result = await searchConversations('xyznonexistent', {
        mode: 'text',
        limit: 10,
        offset: 0
      });

      const formatted = await formatResults(
        result.results,
        result.pagination,
        'markdown'
      );

      expect(formatted).toContain('Showing 0 of');
    });
  });

  describe('Pagination edge cases', () => {
    it('should handle offset equal to total', async () => {
      const firstQuery = await searchConversations('class', {
        mode: 'vector',
        limit: 100
      });

      const result = await searchConversations('class', {
        mode: 'vector',
        limit: 10,
        offset: firstQuery.pagination.total
      });

      expect(result.results.length).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('should calculate nextOffset correctly', async () => {
      const result = await searchConversations('class', {
        mode: 'vector',
        limit: 3,
        offset: 5
      });

      if (result.pagination.hasMore) {
        expect(result.pagination.nextOffset).toBe(8); // 5 + 3
      } else {
        expect(result.pagination.nextOffset).toBeUndefined();
      }
    });

    it('should handle limit larger than remaining results', async () => {
      const firstQuery = await searchConversations('class', {
        mode: 'vector',
        limit: 100
      });

      if (firstQuery.pagination.total > 5) {
        const result = await searchConversations('class', {
          mode: 'vector',
          limit: 100,
          offset: firstQuery.pagination.total - 3
        });

        expect(result.results.length).toBeLessThanOrEqual(3);
        expect(result.pagination.hasMore).toBe(false);
      }
    });
  });
});
