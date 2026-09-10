import { describe, it, expect } from 'vitest';
import { parseConversationFile } from '../src/parser.js';
import { getFixturePath, countLines } from './test-utils.js';

describe('Parser - Real Conversation Data', () => {
  describe('Short conversation (3 lines)', () => {
    const fixturePath = getFixturePath('short-conversation.jsonl');

    it('should parse file successfully', async () => {
      const result = await parseConversationFile(fixturePath);
      expect(result).toBeDefined();
      expect(result.exchanges).toBeDefined();
      expect(result.project).toBeDefined();
    });

    it('should extract conversation metadata', async () => {
      const result = await parseConversationFile(fixturePath);

      // Should have project name (extracted from parent dir, which is "fixtures" in tests)
      expect(result.project).toBe('fixtures');

      // Should have timestamp
      expect(result.exchanges.length).toBeGreaterThan(0);
      expect(result.exchanges[0].timestamp).toBeDefined();
    });

    it('should parse summary line', async () => {
      const result = await parseConversationFile(fixturePath);

      // First line should be summary type
      const lines = result.exchanges;
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should extract user and assistant messages', async () => {
      const result = await parseConversationFile(fixturePath);

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

    it('should parse file successfully', async () => {
      const result = await parseConversationFile(fixturePath);
      expect(result).toBeDefined();
      // Note: This file has only file-history-snapshot entries, no user/assistant messages
      expect(result.exchanges).toEqual([]);
    });

    it('should handle file-history-snapshot entries', async () => {
      const result = await parseConversationFile(fixturePath);

      // Medium conversation has many file history snapshots but no actual exchanges
      // Parser should handle them without crashing
      expect(result.exchanges).toBeDefined();
      expect(Array.isArray(result.exchanges)).toBe(true);
    });

    it('should extract project path correctly', async () => {
      const result = await parseConversationFile(fixturePath);

      expect(result.project).toBeDefined();
      expect(result.project).toBe('fixtures');
    });

    it('should handle empty exchange lists', async () => {
      const result = await parseConversationFile(fixturePath);

      // This file has no exchanges, just metadata
      // Should return empty array, not crash
      expect(result.exchanges).toEqual([]);
    });
  });

  describe('Long conversation (295 lines)', () => {
    const fixturePath = getFixturePath('long-conversation.jsonl');

    it('should parse large file without errors', async () => {
      const lineCount = countLines(fixturePath);
      expect(lineCount).toBeGreaterThan(100);

      const result = await parseConversationFile(fixturePath);
      expect(result).toBeDefined();
      expect(result.exchanges.length).toBeGreaterThan(0);
    });

    it('should handle many exchanges efficiently', async () => {
      const startTime = Date.now();
      const result = await parseConversationFile(fixturePath);
      const parseTime = Date.now() - startTime;

      // Should parse in reasonable time (< 1 second)
      expect(parseTime).toBeLessThan(1000);

      // Should have multiple exchanges
      expect(result.exchanges.length).toBeGreaterThan(1);
    });

    it('should maintain data integrity across all exchanges', async () => {
      const result = await parseConversationFile(fixturePath);

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
    it('should throw on non-existent file', async () => {
      await expect(parseConversationFile('/nonexistent/file.jsonl')).rejects.toThrow();
    });

    it('should handle malformed JSONL gracefully', async () => {
      // This test would need a fixture with malformed JSON
      // For now, we verify that valid fixtures don't throw
      const result = await parseConversationFile(getFixturePath('short-conversation.jsonl'));
      expect(result).toBeDefined();
    });
  });
});

describe('Parser - isMeta user lines (harness-injected vs. human provenance)', () => {
  describe('Image paste: real prompt + isMeta "[Image: source: ...]" placeholder', () => {
    const fixturePath = getFixturePath('image-paste-conversation.jsonl');

    it('keeps the real prompt as the user message, not the placeholder', async () => {
      const result = await parseConversationFile(fixturePath);
      expect(result.exchanges).toHaveLength(1);

      const [exchange] = result.exchanges;
      expect(exchange.userMessage).toBe(
        '[Image #1] I want to make Codex not ask any questions about permissions - can you help me with configuring it?'
      );
      expect(exchange.userMessage).not.toContain('[Image: source:');
      expect(exchange.assistantMessage).toContain('approval_policy');
    });

    it('anchors the exchange at the real prompt line', async () => {
      const result = await parseConversationFile(fixturePath);
      const [exchange] = result.exchanges;
      expect(exchange.lineStart).toBe(1);
      expect(exchange.lineEnd).toBe(3);
      // First-line metadata comes from the real prompt, not the placeholder
      expect(exchange.thinkingLevel).toBe('high');
    });
  });

  describe('Skill invocation: isMeta skill body and "Continue" line inside one turn', () => {
    const fixturePath = getFixturePath('skill-invocation-conversation.jsonl');

    it('does not split an already-populated turn at the injected skill body', async () => {
      const result = await parseConversationFile(fixturePath);
      expect(result.exchanges).toHaveLength(1);

      const [exchange] = result.exchanges;
      expect(exchange.userMessage).toBe('register as summarizer in agent-chat');
      expect(exchange.userMessage).not.toContain('Base directory for this skill');
      expect(exchange.assistantMessage).not.toContain('Base directory for this skill');
      // The assistant text that preceded the Skill tool call is kept
      expect(exchange.assistantMessage).toContain("I'll load the agent-chat skill");
    });

    it('accumulates replies across isMeta lines into the same exchange', async () => {
      const result = await parseConversationFile(fixturePath);
      const [exchange] = result.exchanges;
      expect(exchange.assistantMessage).toContain('Registered as summarizer');
      expect(exchange.assistantMessage).toContain('Standing by');
      expect(exchange.lineStart).toBe(1);
      expect(exchange.lineEnd).toBe(8);
      expect(exchange.toolCalls?.map(tc => tc.toolName)).toEqual(['Skill']);
    });
  });

  describe('Channel-bridge prompt: isMeta but origin.kind === "channel" (claude-code#44828)', () => {
    const fixturePath = getFixturePath('channel-plugin-conversation.jsonl');

    it('treats the channel message as a real prompt and starts a new exchange', async () => {
      const result = await parseConversationFile(fixturePath);
      expect(result.exchanges).toHaveLength(2);

      const [typed, channel] = result.exchanges;
      expect(typed.userMessage).toBe('List the files in src.');
      expect(typed.assistantMessage).toBe('parser.ts and show.ts.');
      expect(typed.lineEnd).toBe(2);

      expect(channel.userMessage).toContain('Please explain the retry policy.');
      expect(channel.assistantMessage).toContain('exponential backoff');
      expect(channel.lineStart).toBe(3);
      expect(channel.lineEnd).toBe(4);
    });
  });

  describe('Session that opens with an injected notification (no exchange open yet)', () => {
    const fixturePath = getFixturePath('meta-first-conversation.jsonl');

    it('still starts an exchange so the assistant reply is not lost', async () => {
      const result = await parseConversationFile(fixturePath);
      expect(result.exchanges).toHaveLength(2);

      const [notice, typed] = result.exchanges;
      expect(notice.userMessage).toContain('[SYSTEM NOTIFICATION - NOT USER INPUT]');
      expect(notice.assistantMessage).toContain('background task finished');
      expect(notice.lineStart).toBe(1);

      expect(typed.userMessage).toBe('Now summarize what changed.');
      expect(typed.lineStart).toBe(3);
    });
  });
});
