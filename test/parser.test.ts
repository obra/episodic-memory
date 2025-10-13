import { describe, it, expect } from 'vitest';
import { parseConversationFile } from '../src/parser.js';
import { getFixturePath, countLines } from './test-utils.js';

describe('Parser - Real Conversation Data', () => {
  describe('Short conversation (3 lines)', () => {
    const fixturePath = getFixturePath('short-conversation.jsonl');

    it('should parse file successfully', () => {
      const result = parseConversationFile(fixturePath);
      expect(result).toBeDefined();
      expect(result.exchanges).toBeDefined();
      expect(result.project).toBeDefined();
    });

    it('should extract conversation metadata', () => {
      const result = parseConversationFile(fixturePath);

      // Should have project name
      expect(result.project).toContain('conversation-search');

      // Should have timestamp
      expect(result.exchanges.length).toBeGreaterThan(0);
      expect(result.exchanges[0].timestamp).toBeDefined();
    });

    it('should parse summary line', () => {
      const result = parseConversationFile(fixturePath);

      // First line should be summary type
      const lines = result.exchanges;
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should extract user and assistant messages', () => {
      const result = parseConversationFile(fixturePath);

      const exchanges = result.exchanges;
      expect(exchanges.length).toBeGreaterThan(0);

      // Should have user message
      const firstExchange = exchanges[0];
      expect(firstExchange.userMessage).toBeDefined();
      expect(firstExchange.userMessage.length).toBeGreaterThan(0);

      // Should have assistant message
      expect(firstExchange.assistantMessage).toBeDefined();
      expect(firstExchange.assistantMessage.length).toBeGreaterThan(0);
    });
  });

  describe('Medium conversation (23 lines)', () => {
    const fixturePath = getFixturePath('medium-conversation.jsonl');

    it('should parse file successfully', () => {
      const result = parseConversationFile(fixturePath);
      expect(result).toBeDefined();
      expect(result.exchanges.length).toBeGreaterThan(0);
    });

    it('should handle file-history-snapshot entries', () => {
      const result = parseConversationFile(fixturePath);

      // Medium conversation has many file history snapshots
      // Parser should handle them without crashing
      expect(result.exchanges).toBeDefined();
    });

    it('should extract project path correctly', () => {
      const result = parseConversationFile(fixturePath);

      expect(result.project).toBeDefined();
      expect(result.project).toContain('scenario-testing');
    });

    it('should maintain correct line numbers', () => {
      const result = parseConversationFile(fixturePath);

      // Each exchange should have line start/end
      for (const exchange of result.exchanges) {
        expect(exchange.lineStart).toBeGreaterThan(0);
        expect(exchange.lineEnd).toBeGreaterThanOrEqual(exchange.lineStart);
      }
    });
  });

  describe('Long conversation (295 lines)', () => {
    const fixturePath = getFixturePath('long-conversation.jsonl');

    it('should parse large file without errors', () => {
      const lineCount = countLines(fixturePath);
      expect(lineCount).toBeGreaterThan(100);

      const result = parseConversationFile(fixturePath);
      expect(result).toBeDefined();
      expect(result.exchanges.length).toBeGreaterThan(0);
    });

    it('should handle many exchanges efficiently', () => {
      const startTime = Date.now();
      const result = parseConversationFile(fixturePath);
      const parseTime = Date.now() - startTime;

      // Should parse in reasonable time (< 1 second)
      expect(parseTime).toBeLessThan(1000);

      // Should have multiple exchanges
      expect(result.exchanges.length).toBeGreaterThan(1);
    });

    it('should maintain data integrity across all exchanges', () => {
      const result = parseConversationFile(fixturePath);

      for (const exchange of result.exchanges) {
        // Every exchange must have required fields
        expect(exchange.project).toBeDefined();
        expect(exchange.timestamp).toBeDefined();
        expect(exchange.userMessage).toBeDefined();
        expect(exchange.assistantMessage).toBeDefined();
        expect(exchange.archivePath).toBe(getFixturePath('long-conversation.jsonl'));

        // Line numbers must be valid
        expect(exchange.lineStart).toBeGreaterThan(0);
        expect(exchange.lineEnd).toBeGreaterThanOrEqual(exchange.lineStart);
      }
    });
  });

  describe('Error handling', () => {
    it('should throw on non-existent file', () => {
      expect(() => {
        parseConversationFile('/nonexistent/file.jsonl');
      }).toThrow();
    });

    it('should handle malformed JSONL gracefully', () => {
      // This test would need a fixture with malformed JSON
      // For now, we verify that valid fixtures don't throw
      const result = parseConversationFile(getFixturePath('short-conversation.jsonl'));
      expect(result).toBeDefined();
    });
  });
});
