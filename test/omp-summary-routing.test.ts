import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConversationExchange } from '../src/types.js';

// Mock the SDK so no test makes a live query() call.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
import { query } from '@anthropic-ai/claude-agent-sdk';
import { summarizeConversation } from '../src/summarizer.js';

function asyncIterableFor(messages: unknown[]): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next() {
          return i < messages.length
            ? Promise.resolve({ value: messages[i++], done: false })
            : Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

function ompExchange(over: Partial<ConversationExchange> = {}): ConversationExchange {
  return {
    id: 'omp-1',
    project: 'p',
    timestamp: '2026-01-01T12:00:00Z',
    userMessage: 'Add OMP as a fifth harness',
    assistantMessage: 'Wired parseOmpConversation through the dispatch and detection.',
    archivePath: '/tmp/archive/omp-sess_abc.jsonl',
    lineStart: 2,
    lineEnd: 3,
    harness: 'omp',
    sessionId: 'omp_sess_abc',
    cwd: '/tmp/nope',
    ...over,
  };
}

describe('summarizeConversation — OMP routes to transcript text (never resume)', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('summarizes an OMP conversation with resume disabled and the transcript in the prompt', async () => {
    vi.mocked(query).mockReturnValueOnce(asyncIterableFor([
      { type: 'result', is_error: false, result: '<summary>Added OMP as a fifth harness.</summary>' },
    ]) as any);

    // Even though a sessionId is passed, the harness gate must prevent a
    // doomed `claude --resume` on an OMP id and go straight to transcript.
    const result = await summarizeConversation([ompExchange()], 'omp_sess_abc');

    expect(result).toBe('Added OMP as a fifth harness.');
    // Exactly one call: a resume attempt + transcript fallback would be two.
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(query).mock.calls[0][0].options as any;
    expect(opts.resume).toBeUndefined();
    const prompt = vi.mocked(query).mock.calls[0][0].prompt as string;
    expect(prompt).toContain('Add OMP as a fifth harness');
    expect(prompt).toContain('Wired parseOmpConversation');
  });
});
