import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConversationExchange } from '../src/types.js';

// Stub the SDK's query() so each test controls what the model "replies".
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  summarizeConversation,
  extractSummary,
  NoSummaryError,
  TRANSCRIPT_IS_DATA,
} from '../src/summarizer.js';

function reply(result: string): AsyncIterable<unknown> {
  const messages = [{ type: 'result', is_error: false, result }];
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

// A subagent transcript opens with a task brief addressed to the agent. That
// brief is what the summarizer used to obey instead of summarizing.
const TASK_BRIEF = 'You are reviewing Task 5 of the plan. Read the brief at /repo/task-5.md and report spec compliance.';

function makeExchange(i: number, overrides: Partial<ConversationExchange> = {}): ConversationExchange {
  return {
    id: `ex-${i}`,
    project: 'test-project',
    timestamp: '2025-10-01T12:00:00Z',
    userMessage: i === 0 ? TASK_BRIEF : `Follow-up question ${i}`,
    assistantMessage: `Reviewed item ${i}; it matches the spec.`,
    archivePath: '/tmp/archive/agent-abc.jsonl',
    lineStart: i * 2 + 1,
    lineEnd: i * 2 + 2,
    cwd: '/tmp/nonexistent-cwd-for-test',
    ...overrides,
  };
}

function lastPrompt(): string {
  const calls = vi.mocked(query).mock.calls;
  return calls[calls.length - 1][0].prompt as string;
}

describe('extractSummary', () => {
  it('returns the trimmed <summary> content', () => {
    expect(extractSummary('preamble <summary>  Did the thing. </summary> trailer')).toBe('Did the thing.');
  });

  it('throws NoSummaryError instead of returning a reply that is not a summary', () => {
    expect(() => extractSummary('### Spec Compliance\n\nCompliant.')).toThrow(NoSummaryError);
    expect(() => extractSummary('I cannot access the filesystem paths you referenced.')).toThrow(NoSummaryError);
  });

  it('throws NoSummaryError on an empty <summary> block', () => {
    expect(() => extractSummary('<summary>   </summary>')).toThrow(NoSummaryError);
  });
});

describe('summarizeConversation — transcript is data, not instructions', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('short path: wraps the transcript in <transcript> tags and ends the prompt with the data reminder', async () => {
    vi.mocked(query).mockReturnValueOnce(reply('<summary>Reviewed Task 5 for spec compliance.</summary>') as any);

    const result = await summarizeConversation([makeExchange(0), makeExchange(1)]);

    expect(result).toBe('Reviewed Task 5 for spec compliance.');
    const prompt = lastPrompt();
    const open = prompt.indexOf('<transcript>');
    const close = prompt.indexOf('</transcript>');
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    // The task brief sits inside the delimiters, and the instruction comes last.
    const brief = prompt.indexOf(TASK_BRIEF);
    expect(brief).toBeGreaterThan(open);
    expect(brief).toBeLessThan(close);
    expect(prompt.trimEnd().endsWith(TRANSCRIPT_IS_DATA)).toBe(true);
  });

  it('short path: a reply that performs the task instead of summarizing is rejected, not stored', async () => {
    vi.mocked(query).mockReturnValueOnce(reply('### Spec Compliance\n\nCompliant. All requirements met.') as any);

    await expect(summarizeConversation([makeExchange(0), makeExchange(1)])).rejects.toBeInstanceOf(NoSummaryError);
  });

  it('resume path: a resumed session that keeps working falls back to the transcript-text path', async () => {
    vi.mocked(query)
      .mockReturnValueOnce(reply('Let me verify the current state of the codebase first.') as any)
      .mockReturnValueOnce(reply('<summary>Fixed two forecasting bugs in the budget scheduler.</summary>') as any);

    const exchanges = [makeExchange(0, { sessionId: 'abc-123' }), makeExchange(1, { sessionId: 'abc-123' })];
    const result = await summarizeConversation(exchanges, 'abc-123');

    expect(result).toBe('Fixed two forecasting bugs in the budget scheduler.');
    expect(vi.mocked(query)).toHaveBeenCalledTimes(2);
    expect((vi.mocked(query).mock.calls[0][0].options as any).resume).toBe('abc-123');
    expect((vi.mocked(query).mock.calls[1][0].options as any).resume).toBeUndefined();
    const fallback = lastPrompt();
    expect(fallback).toContain('<transcript>');
    expect(fallback.trimEnd().endsWith(TRANSCRIPT_IS_DATA)).toBe(true);
  });

  it('chunk path: each chunk prompt wraps its transcript and ends with the data reminder', async () => {
    // 16 exchanges forces hierarchical summarization: 2 chunks + 1 synthesis.
    vi.mocked(query)
      .mockReturnValueOnce(reply('<summary>Chunk one.</summary>') as any)
      .mockReturnValueOnce(reply('<summary>Chunk two.</summary>') as any)
      .mockReturnValueOnce(reply('<summary>Whole review.</summary>') as any);

    const exchanges = Array.from({ length: 16 }, (_, i) => makeExchange(i));
    const result = await summarizeConversation(exchanges);

    expect(result).toBe('Whole review.');
    for (const call of vi.mocked(query).mock.calls.slice(0, 2)) {
      const prompt = call[0].prompt as string;
      expect(prompt).toContain('<transcript>');
      expect(prompt.trimEnd().endsWith(TRANSCRIPT_IS_DATA)).toBe(true);
    }
    expect(vi.mocked(query).mock.calls[0][0].prompt as string).toContain(TASK_BRIEF);
  });

  it('chunk path: a chunk reply that is not a summary is skipped, not folded into the synthesis', async () => {
    vi.mocked(query)
      .mockReturnValueOnce(reply('I cannot access /repo/task-5.md.') as any)
      .mockReturnValueOnce(reply('<summary>Chunk two.</summary>') as any)
      .mockReturnValueOnce(reply('<summary>Whole review.</summary>') as any);

    const exchanges = Array.from({ length: 16 }, (_, i) => makeExchange(i));
    await summarizeConversation(exchanges);

    const synthesisPrompt = lastPrompt();
    expect(synthesisPrompt).toContain('Chunk two.');
    expect(synthesisPrompt).not.toContain('I cannot access');
  });
});
