import { describe, it, expect, afterEach } from 'vitest';
import { summarizeConversation } from '../src/summarizer.js';
import type { ConversationExchange } from '../src/types.js';

describe('API Configuration', () => {
  afterEach(() => {
    // Restore only the env vars we changed
    delete process.env.EPISODIC_MEMORY_API_BASE_URL;
    delete process.env.EPISODIC_MEMORY_API_TOKEN;
    delete process.env.EPISODIC_MEMORY_API_MODEL;
    delete process.env.EPISODIC_MEMORY_API_TIMEOUT_MS;
  });

  it('should use custom API endpoint when EPISODIC_MEMORY_API_BASE_URL is set', async () => {
    // Set env vars to point to an invalid endpoint
    process.env.EPISODIC_MEMORY_API_BASE_URL = 'https://httpbin.org/status/418';
    process.env.EPISODIC_MEMORY_API_TOKEN = 'test-token';

    const exchanges: ConversationExchange[] = [
      {
        id: 'test-1',
        project: 'test',
        timestamp: new Date().toISOString(),
        archivePath: '/test/path.jsonl',
        lineStart: 1,
        lineEnd: 10,
        userMessage: 'Implement JWT authentication with refresh tokens',
        assistantMessage: 'I will create an auth context with token rotation...'
      },
      {
        id: 'test-2',
        project: 'test',
        timestamp: new Date().toISOString(),
        archivePath: '/test/path.jsonl',
        lineStart: 11,
        lineEnd: 20,
        userMessage: 'How do protected routes work?',
        assistantMessage: 'We use a ProtectedRoute component that checks auth...'
      }
    ];

    // Should fail because httpbin returns 418 "I'm a teapot"
    const result = await summarizeConversation(exchanges);

    // The result should contain an error from httpbin, proving our env vars were used
    expect(result).toMatch(/API Error|418|teapot/i);
  }, 30000);
});
