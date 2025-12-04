import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { formatConversationWithMetadata } from '../src/show';
import { PAGINATION_DEFAULTS } from '../src/constants';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Conversation Pagination', () => {
  const tinyConversation = fs.readFileSync(
    path.join(FIXTURES_DIR, 'tiny-conversation.jsonl'),
    'utf-8'
  );
  const longConversation = fs.readFileSync(
    path.join(FIXTURES_DIR, 'long-conversation.jsonl'),
    'utf-8'
  );

  describe('formatConversationWithMetadata', () => {
    it('should return full content for small files', () => {
      const result = formatConversationWithMetadata(tinyConversation);
      expect(result.metadata.totalLines).toBe(7);
      expect(result.metadata.hasMore).toBe(false);
      expect(result.metadata.startLine).toBe(1);
      expect(result.metadata.endLine).toBe(7);
      expect(result.content).toContain('# Conversation');
    });

    it('should paginate large files', () => {
      const result = formatConversationWithMetadata(longConversation, 1, 50);
      expect(result.metadata.startLine).toBe(1);
      expect(result.metadata.endLine).toBe(50);
      expect(result.metadata.totalLines).toBe(295);
      expect(result.metadata.hasMore).toBe(true);
      expect(result.metadata.suggestedNextRange).toEqual({ start: 51, end: 150 });
    });

    it('should respect custom page size', () => {
      const result = formatConversationWithMetadata(longConversation, 1, undefined, 25);
      expect(result.metadata.endLine).toBe(25);
      expect(result.metadata.hasMore).toBe(true);
      expect(result.metadata.suggestedNextRange).toEqual({ start: 26, end: 50 });
    });

    it('should cap endLine at totalLines', () => {
      const result = formatConversationWithMetadata(tinyConversation, 1, 1000);
      expect(result.metadata.endLine).toBeLessThanOrEqual(result.metadata.totalLines);
      expect(result.metadata.endLine).toBe(7);
    });

    it('should set hasMore=false on last page', () => {
      const result = formatConversationWithMetadata(tinyConversation, 1, 100);
      expect(result.metadata.hasMore).toBe(false);
      expect(result.metadata.suggestedNextRange).toBeUndefined();
    });

    it('should calculate correct file size', () => {
      const result = formatConversationWithMetadata(longConversation);
      expect(result.metadata.totalSizeKB).toBeGreaterThan(100);
    });

    it('should handle default pagination (no args)', () => {
      const result = formatConversationWithMetadata(longConversation);
      expect(result.metadata.startLine).toBe(1);
      expect(result.metadata.endLine).toBe(100); // default page size
      expect(result.metadata.hasMore).toBe(true);
    });

    it('should handle middle pages correctly', () => {
      const result = formatConversationWithMetadata(longConversation, 101, 200);
      expect(result.metadata.startLine).toBe(101);
      expect(result.metadata.endLine).toBe(200);
      expect(result.metadata.hasMore).toBe(true);
      // Next range is capped at totalLines (295)
      expect(result.metadata.suggestedNextRange).toEqual({ start: 201, end: 295 });
    });

    it('should handle last partial page', () => {
      const result = formatConversationWithMetadata(longConversation, 251, 350);
      expect(result.metadata.startLine).toBe(251);
      expect(result.metadata.endLine).toBe(295); // capped at total
      expect(result.metadata.hasMore).toBe(false);
      expect(result.metadata.suggestedNextRange).toBeUndefined();
    });
  });

  describe('page conversion', () => {
    it('should convert page 1 to lines 1-100', () => {
      const page = 1;
      const pageSize = 100;
      const startLine = (page - 1) * pageSize + 1;
      const endLine = page * pageSize;
      expect(startLine).toBe(1);
      expect(endLine).toBe(100);
    });

    it('should convert page 3 to lines 201-300', () => {
      const page = 3;
      const pageSize = 100;
      const startLine = (page - 1) * pageSize + 1;
      const endLine = page * pageSize;
      expect(startLine).toBe(201);
      expect(endLine).toBe(300);
    });

    it('should convert page 2 with custom page size', () => {
      const page = 2;
      const pageSize = 50;
      const startLine = (page - 1) * pageSize + 1;
      const endLine = page * pageSize;
      expect(startLine).toBe(51);
      expect(endLine).toBe(100);
    });
  });

  describe('edge cases', () => {
    it('should handle empty conversation', () => {
      const emptyConversation = '\n\n\n';
      const result = formatConversationWithMetadata(emptyConversation);
      expect(result.metadata.totalLines).toBe(0);
      expect(result.metadata.hasMore).toBe(false);
    });

    it('should handle single line', () => {
      const lines = tinyConversation.split('\n').filter(l => l.trim());
      const singleLine = lines[0];
      const result = formatConversationWithMetadata(singleLine);
      expect(result.metadata.totalLines).toBe(1);
      expect(result.metadata.hasMore).toBe(false);
    });

    it('should handle startLine only (endLine undefined)', () => {
      const result = formatConversationWithMetadata(longConversation, 50, undefined);
      expect(result.metadata.startLine).toBe(50);
      expect(result.metadata.endLine).toBe(149); // 50 + 100 - 1
    });
  });

  describe('pagination metadata fields', () => {
    it('should include all required metadata fields', () => {
      const result = formatConversationWithMetadata(longConversation, 1, 50);
      expect(result.metadata).toHaveProperty('totalLines');
      expect(result.metadata).toHaveProperty('totalSizeKB');
      expect(result.metadata).toHaveProperty('startLine');
      expect(result.metadata).toHaveProperty('endLine');
      expect(result.metadata).toHaveProperty('hasMore');
      expect(result.metadata).toHaveProperty('suggestedNextRange');
    });

    it('should calculate totalSizeKB correctly', () => {
      // Use actual JSONL data for size calculation test
      const result = formatConversationWithMetadata(tinyConversation);
      const expectedKB = Math.round(tinyConversation.length / 1024 * 10) / 10;
      expect(result.metadata.totalSizeKB).toBe(expectedKB);
    });
  });
});
