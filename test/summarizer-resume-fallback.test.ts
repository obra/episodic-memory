import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ConversationExchange } from '../src/types.js';

// Stub the SDK's query() so each test controls what messages it yields.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { summarizeConversation, SummarizerSdkError } from '../src/summarizer.js';

function asyncIterableFor(sdkMessages: unknown[]): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next() {
          if (i < sdkMessages.length) {
            return Promise.resolve({ value: sdkMessages[i++], done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

function makeExchange(overrides: Partial<ConversationExchange> = {}): ConversationExchange {
  return {
    id: 'ex-1',
    project: 'test-project',
    timestamp: '2025-10-01T12:00:00Z',
    userMessage: 'How do I rebase against origin/main?',
    assistantMessage: 'Use git rebase origin/main from your feature branch.',
    archivePath: '/tmp/archive/test.jsonl',
    lineStart: 1,
    lineEnd: 2,
    sessionId: 'abc-123',
    cwd: '/tmp/nonexistent-cwd-for-test',
    ...overrides,
  };
}

describe('summarizeConversation — Claude resume fallback (cwd-mismatch recovery)', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('propagates SDK is_error results as SummarizerSdkError when the fallback also fails', async () => {
    vi.mocked(query)
      .mockReturnValueOnce(asyncIterableFor([
        { type: 'result', is_error: true, subtype: 'error_during_execution' },
      ]) as any)
      .mockReturnValueOnce(asyncIterableFor([
        { type: 'result', is_error: true, subtype: 'error_during_execution' },
      ]) as any);

    await expect(summarizeConversation([makeExchange()], 'abc-123'))
      .rejects.toBeInstanceOf(SummarizerSdkError);
  });

  it('attaches the SDK subtype and session_id to the thrown SummarizerSdkError', async () => {
    vi.mocked(query).mockReturnValueOnce(asyncIterableFor([
      { type: 'result', is_error: true, subtype: 'auth_failed', session_id: 'sdk-session-id-xyz' },
    ]) as any);

    let caught: unknown;
    try {
      await summarizeConversation([makeExchange()], 'abc-123');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SummarizerSdkError);
    expect((caught as SummarizerSdkError).subtype).toBe('auth_failed');
    expect((caught as SummarizerSdkError).sessionId).toBe('sdk-session-id-xyz');
  });

  it('retries without resume when the first call fails with is_error, returning the second call\'s summary', async () => {
    vi.mocked(query)
      .mockReturnValueOnce(asyncIterableFor([
        { type: 'result', is_error: true, subtype: 'error_during_execution' },
      ]) as any)
      .mockReturnValueOnce(asyncIterableFor([
        { type: 'result', is_error: false, result: '<summary>Recovered summary text.</summary>' },
      ]) as any);

    const result = await summarizeConversation([makeExchange()], 'abc-123');
    expect(result).toBe('Recovered summary text.');
    expect(vi.mocked(query)).toHaveBeenCalledTimes(2);

    const firstCallOptions = vi.mocked(query).mock.calls[0][0].options as any;
    expect(firstCallOptions.resume).toBe('abc-123');

    // The fallback omits resume so the SDK opens a fresh session, and the
    // prompt grows to include the conversation text the fresh session needs.
    const secondCallOptions = vi.mocked(query).mock.calls[1][0].options as any;
    expect(secondCallOptions.resume).toBeUndefined();
    const secondPrompt = vi.mocked(query).mock.calls[1][0].prompt as string;
    expect(secondPrompt).toContain('How do I rebase against origin/main?');
    expect(secondPrompt).toContain('Use git rebase origin/main');
  });

  it('passes the session\'s recorded cwd to the SDK when the path still exists on disk', async () => {
    const realCwd = mkdtempSync(join(tmpdir(), 'episodic-memory-cwd-test-'));
    try {
      vi.mocked(query).mockReturnValueOnce(asyncIterableFor([
        { type: 'result', is_error: false, result: '<summary>ok</summary>' },
      ]) as any);

      await summarizeConversation([makeExchange({ cwd: realCwd })], 'abc-123');

      const opts = vi.mocked(query).mock.calls[0][0].options as any;
      expect(opts.cwd).toBe(realCwd);
      expect(opts.resume).toBe('abc-123');
    } finally {
      rmSync(realCwd, { recursive: true, force: true });
    }
  });

  it('omits cwd from SDK options when the session\'s recorded cwd no longer exists (dead worktree)', async () => {
    vi.mocked(query).mockReturnValueOnce(asyncIterableFor([
      { type: 'result', is_error: false, result: '<summary>ok</summary>' },
    ]) as any);

    await summarizeConversation([makeExchange({ cwd: '/definitely/not/here' })], 'abc-123');

    const opts = vi.mocked(query).mock.calls[0][0].options as any;
    expect(opts.cwd).toBeUndefined();
    expect(opts.resume).toBe('abc-123');
  });

  it('does not retry when the SDK throws a non-resume error', async () => {
    vi.mocked(query).mockImplementationOnce(() => {
      throw new Error('Network unreachable');
    });

    await expect(summarizeConversation([makeExchange()], 'abc-123'))
      .rejects.toThrow(/Network unreachable/);
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the SDK yields is_error with a subtype isResumeFailure rejects', async () => {
    // Non-resume subtypes must propagate without firing the fallback.
    vi.mocked(query).mockReturnValueOnce(asyncIterableFor([
      { type: 'result', is_error: true, subtype: 'auth_failed' },
    ]) as any);

    await expect(summarizeConversation([makeExchange()], 'abc-123'))
      .rejects.toBeInstanceOf(SummarizerSdkError);
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
  });

  it('falls back to the non-resume path when resume hits the thinking-block 400, returning the recovered summary', async () => {
    // Resume replays immutable thinking blocks → 400 (subtype 'success',
    // is_error true). The non-resume path retries with the transcript as text.
    vi.mocked(query)
      .mockReturnValueOnce(asyncIterableFor([
        {
          type: 'result',
          subtype: 'success',
          is_error: true,
          api_error_status: 400,
          session_id: 'abc-123',
          result: 'API Error: 400 messages.1.content.25: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response.',
        },
      ]) as any)
      .mockReturnValueOnce(asyncIterableFor([
        { type: 'result', is_error: false, result: '<summary>Summary recovered via transcript fallback.</summary>' },
      ]) as any);

    const result = await summarizeConversation([makeExchange()], 'abc-123');
    expect(result).toBe('Summary recovered via transcript fallback.');
    expect(vi.mocked(query)).toHaveBeenCalledTimes(2);

    const firstCallOptions = vi.mocked(query).mock.calls[0][0].options as any;
    expect(firstCallOptions.resume).toBe('abc-123');

    const secondCallOptions = vi.mocked(query).mock.calls[1][0].options as any;
    expect(secondCallOptions.resume).toBeUndefined();
    const secondPrompt = vi.mocked(query).mock.calls[1][0].prompt as string;
    expect(secondPrompt).toContain('How do I rebase against origin/main?');
  });
});
