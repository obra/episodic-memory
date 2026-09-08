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

function opencodeExchange(over: Partial<ConversationExchange> = {}): ConversationExchange {
  return {
    id: 'oc-1',
    project: 'p',
    timestamp: '2025-10-01T12:00:00Z',
    userMessage: 'Add retry to the opencode exporter',
    assistantMessage: 'Wrapped exportOpencodeSessions in a per-session try/catch.',
    archivePath: '/tmp/archive/opencode-ses_abc.jsonl',
    lineStart: 1,
    lineEnd: 2,
    harness: 'opencode',
    sessionId: 'ses_abc',
    cwd: '/tmp/nope',
    ...over,
  };
}

describe('summarizeConversation — opencode routes to transcript text (never resume)', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('summarizes an opencode conversation with resume disabled and transcript in the prompt', async () => {
    vi.mocked(query).mockReturnValueOnce(asyncIterableFor([
      { type: 'result', is_error: false, result: '<summary>Added retry to opencode exporter.</summary>' },
    ]) as any);

    // Even though a sessionId is passed, the harness gate must prevent a
    // doomed `claude --resume` on an opencode id and go straight to transcript.
    const result = await summarizeConversation([opencodeExchange()], 'ses_abc');

    expect(result).toBe('Added retry to opencode exporter.');
    // Exactly one call: a resume attempt + transcript fallback would be two.
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(query).mock.calls[0][0].options as any;
    expect(opts.resume).toBeUndefined();
    const prompt = vi.mocked(query).mock.calls[0][0].prompt as string;
    expect(prompt).toContain('Add retry to the opencode exporter');
    expect(prompt).toContain('Wrapped exportOpencodeSessions');
  });
});
