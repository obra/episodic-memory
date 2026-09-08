import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the SDK so no test can make a live query() call.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  SummarizerSdkError,
  SummarizerTimeoutError,
  resetMeteredApiWarningForTests,
  isResumeFailure,
  isProcessExitFailure,
  isAuthFailure,
  truncateSdkErrorDetail,
  wouldBillMeteredApi,
  meteredApiOptIn,
  summaryTimeoutMs,
  runSummarizerQuery,
  summarizeConversation,
  type SummarizerQueryFn,
} from '../src/summarizer.js';
import type { ConversationExchange } from '../src/types.js';

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

// An iterable whose next() never resolves — simulates a wedged subprocess.
function neverResolvingIterable(): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise<never>(() => {}) };
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

const METERED_ENV = [
  'ANTHROPIC_API_KEY',
  'EPISODIC_MEMORY_ALLOW_METERED_API',
  'EPISODIC_MEMORY_API_BASE_URL',
  'EPISODIC_MEMORY_API_TOKEN',
  'EPISODIC_MEMORY_SUMMARY_TIMEOUT_MS',
];
function clearMeteredEnv() {
  for (const k of METERED_ENV) delete process.env[k];
}

// Belt-and-suspenders: no ambient billing key leaks into any test in this file.
beforeEach(() => clearMeteredEnv());
afterEach(() => clearMeteredEnv());

// ─────────────────────────────────────────────────────────────────────────────
// 3a — #110: extended-thinking 400 + api_error_status surfaced
// ─────────────────────────────────────────────────────────────────────────────
describe('3a/#110 — thinking-block 400 classification', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('carries apiErrorStatus + detail and renders a diagnostic message', () => {
    const err = new SummarizerSdkError(
      'success', 'abc-123', 400,
      'API Error: 400 messages.1.content.25: `thinking` or `redacted_thinking` blocks cannot be modified.',
    );
    expect(err.subtype).toBe('success');
    expect(err.apiErrorStatus).toBe(400);
    expect(err.detail).toContain('thinking');
    expect(err.message).not.toBe('Summarizer SDK error: success');
    expect(err.message).toContain('400');
    expect(err.message).toContain('cannot be modified');
  });

  it('isResumeFailure matches HTTP 400 but not other statuses', () => {
    expect(isResumeFailure(new SummarizerSdkError('success', 'x', 400, 'thinking'))).toBe(true);
    expect(isResumeFailure(new SummarizerSdkError('success', 'x', 401, 'auth'))).toBe(false);
    expect(isResumeFailure(new SummarizerSdkError('success', 'x', 429, 'rate'))).toBe(false);
    expect(isResumeFailure(new SummarizerSdkError('success', 'x', 529, 'overloaded'))).toBe(false);
  });

  it('summarizeConversation falls back to transcript text on a resume 400', async () => {
    vi.mocked(query)
      .mockReturnValueOnce(asyncIterableFor([{
        type: 'result', subtype: 'success', is_error: true, api_error_status: 400,
        session_id: 'abc-123',
        result: 'API Error: 400 messages.1.content.25: `thinking` blocks cannot be modified.',
      }]) as any)
      .mockReturnValueOnce(asyncIterableFor([
        { type: 'result', is_error: false, result: '<summary>Recovered via transcript.</summary>' },
      ]) as any);

    const result = await summarizeConversation([makeExchange()], 'abc-123');
    expect(result).toBe('Recovered via transcript.');
    expect(vi.mocked(query)).toHaveBeenCalledTimes(2);
    expect((vi.mocked(query).mock.calls[1][0].options as any).resume).toBeUndefined();
    expect(vi.mocked(query).mock.calls[1][0].prompt as string).toContain('How do I rebase');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3a — #145/#138: is_error subtype 'success' with a 401 → surface real text; auth classifier
// ─────────────────────────────────────────────────────────────────────────────
describe('3a/#138 — auth failure text surfaced + isAuthFailure', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('surfaces the SDK result text instead of "Summarizer SDK error: success"', async () => {
    const authResult =
      'Failed to authenticate. API Error: 401 {"error":{"type":"authentication_error","message":"OAuth access token has expired."}}';
    vi.mocked(query).mockReturnValueOnce(asyncIterableFor([{
      type: 'result', is_error: true, subtype: 'success', api_error_status: 401,
      session_id: 'sess-xyz', result: authResult,
    }]) as any);

    let caught: unknown;
    try { await summarizeConversation([makeExchange()], 'abc-123'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(SummarizerSdkError);
    const err = caught as SummarizerSdkError;
    expect(err.detail).toMatch(/OAuth access token has expired/);
    expect(err.message).toMatch(/Summarizer SDK error: success/);
    expect(err.message).toMatch(/401/);
    expect(err.message).toMatch(/OAuth access token has expired/);
    // Auth is not resume-specific → no fallback → query called once.
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
  });

  it('isAuthFailure detects 401/OAuth even when subtype is success', () => {
    expect(isAuthFailure(new SummarizerSdkError(
      'success', 's', 401, 'Failed to authenticate. authentication_error OAuth access token has expired'))).toBe(true);
    expect(isAuthFailure(new Error('Failed to authenticate. API Error: 401'))).toBe(true);
    expect(isAuthFailure(new SummarizerSdkError('error_during_execution'))).toBe(false);
    expect(isAuthFailure(new SummarizerSdkError('rate_limit'))).toBe(false);
    expect(isAuthFailure(new Error('Network unreachable'))).toBe(false);
    expect(isAuthFailure(undefined)).toBe(false);
  });

  it('truncateSdkErrorDetail caps long detail', () => {
    const out = truncateSdkErrorDetail('x'.repeat(500), 50);
    expect(out.length).toBe(50);
    expect(out.endsWith('…')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3a — #147: nonzero subprocess exit → transcript fallback
// ─────────────────────────────────────────────────────────────────────────────
describe('3a/#147 — process-exit fallback', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('isProcessExitFailure matches exit/signal Errors only', () => {
    expect(isProcessExitFailure(new Error('Claude Code process exited with code 1'))).toBe(true);
    expect(isProcessExitFailure(new Error('terminated by signal SIGKILL'))).toBe(true);
    expect(isProcessExitFailure(new Error('Network unreachable'))).toBe(false);
    expect(isProcessExitFailure(new SummarizerSdkError('error_during_execution'))).toBe(false);
  });

  it('falls back to transcript text when the resume subprocess exits nonzero', async () => {
    vi.mocked(query)
      .mockImplementationOnce(() => { throw new Error('Claude Code process exited with code 1'); })
      .mockReturnValueOnce(asyncIterableFor([
        { type: 'result', is_error: false, result: '<summary>Recovered from exit 1.</summary>' },
      ]) as any);

    const result = await summarizeConversation([makeExchange()], 'abc-123');
    expect(result).toBe('Recovered from exit 1.');
    expect(vi.mocked(query)).toHaveBeenCalledTimes(2);
    expect((vi.mocked(query).mock.calls[1][0].options as any).resume).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3b — #122: archive-only "No conversation found" (subtype 'success') → fallback
// ─────────────────────────────────────────────────────────────────────────────
describe('3b/#122 — archive-only resume fallback', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('isResumeFailure matches subtype success + "No conversation found" but not auth-success', () => {
    expect(isResumeFailure(new SummarizerSdkError(
      'success', 's', null, 'No conversation found with session ID: abc'))).toBe(true);
    expect(isResumeFailure(new SummarizerSdkError(
      'success', 's', 401, 'Failed to authenticate'))).toBe(false);
    expect(isResumeFailure(new SummarizerSdkError('success', 's'))).toBe(false);
  });

  it('falls back to transcript text on a "No conversation found" resume result', async () => {
    vi.mocked(query)
      .mockReturnValueOnce(asyncIterableFor([{
        type: 'result', subtype: 'success', is_error: true, session_id: 'abc-123',
        result: 'No conversation found with session ID: abc-123',
      }]) as any)
      .mockReturnValueOnce(asyncIterableFor([
        { type: 'result', is_error: false, result: '<summary>Recovered archive-only summary.</summary>' },
      ]) as any);

    const result = await summarizeConversation([makeExchange()], 'abc-123');
    expect(result).toBe('Recovered archive-only summary.');
    expect(vi.mocked(query)).toHaveBeenCalledTimes(2);
    expect((vi.mocked(query).mock.calls[1][0].options as any).resume).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3c — #160: query timeout (injected fake slow query; no live SDK)
// ─────────────────────────────────────────────────────────────────────────────
describe('3c/#160 — summarizer query timeout', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('summaryTimeoutMs defaults to 120000 and honors the env override', () => {
    delete process.env.EPISODIC_MEMORY_SUMMARY_TIMEOUT_MS;
    expect(summaryTimeoutMs()).toBe(120000);
    process.env.EPISODIC_MEMORY_SUMMARY_TIMEOUT_MS = '250';
    expect(summaryTimeoutMs()).toBe(250);
    process.env.EPISODIC_MEMORY_SUMMARY_TIMEOUT_MS = 'garbage';
    expect(summaryTimeoutMs()).toBe(120000);
  });

  it('runSummarizerQuery aborts and throws SummarizerTimeoutError when the query never yields', async () => {
    const aborts: boolean[] = [];
    // Fake query records whether it was aborted; its iterator never resolves.
    const fakeQuery: SummarizerQueryFn = ({ options }) => {
      (options as any).abortController.signal.addEventListener('abort', () => aborts.push(true));
      return neverResolvingIterable();
    };

    await expect(runSummarizerQuery(fakeQuery, 'prompt', {}, 20))
      .rejects.toBeInstanceOf(SummarizerTimeoutError);
    expect(aborts).toEqual([true]); // AbortController was fired
  });

  it('runSummarizerQuery returns the result when the query completes before the timeout', async () => {
    const fakeQuery: SummarizerQueryFn = () =>
      asyncIterableFor([{ type: 'result', is_error: false, result: '<summary>fast</summary>' }]);
    const out = await runSummarizerQuery(fakeQuery, 'prompt', {}, 5000);
    expect(out).toBe('<summary>fast</summary>');
  });

  it('surfaces the timeout through summarizeConversation without an infinite loop', async () => {
    process.env.EPISODIC_MEMORY_SUMMARY_TIMEOUT_MS = '20';
    vi.mocked(query).mockReturnValue(neverResolvingIterable() as any);

    await expect(summarizeConversation([makeExchange()], 'abc-123'))
      .rejects.toBeInstanceOf(SummarizerTimeoutError);
    // Timeout is neither a resume nor a process-exit failure, so no fallback retry.
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3d — #104: metered-API cost guard
// ─────────────────────────────────────────────────────────────────────────────
describe('3d/#104 — metered API cost guard', () => {
  beforeEach(() => { vi.mocked(query).mockReset(); clearMeteredEnv(); });

  it('wouldBillMeteredApi is true only for a bare inherited ANTHROPIC_API_KEY', () => {
    expect(wouldBillMeteredApi()).toBe(false); // subscription: no key
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
    expect(wouldBillMeteredApi()).toBe(true);
    // An explicit episodic-memory endpoint is a deliberate choice — not guarded.
    process.env.EPISODIC_MEMORY_API_BASE_URL = 'https://self-hosted.invalid';
    expect(wouldBillMeteredApi()).toBe(false);
    delete process.env.EPISODIC_MEMORY_API_BASE_URL;
    process.env.EPISODIC_MEMORY_API_TOKEN = 'tok';
    expect(wouldBillMeteredApi()).toBe(false);
  });

  it('meteredApiOptIn is true only for the explicit flag', () => {
    expect(meteredApiOptIn()).toBe(false);
    process.env.EPISODIC_MEMORY_ALLOW_METERED_API = '1';
    expect(meteredApiOptIn()).toBe(true);
    process.env.EPISODIC_MEMORY_ALLOW_METERED_API = 'true';
    expect(meteredApiOptIn()).toBe(false); // strict '1' only
  });

  it('summarizeConversation warns once but still summarizes when a key would be billed', async () => {
    resetMeteredApiWarningForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
    vi.mocked(query).mockReturnValueOnce(asyncIterableFor([
      { type: 'result', is_error: false, result: '<summary>billed but done</summary>' },
    ]) as any);
    const out = await summarizeConversation([makeExchange()], undefined);
    expect(out).toBe('billed but done');
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/metered Anthropic API/);
    // Second call in the same process does not warn again.
    vi.mocked(query).mockReturnValueOnce(asyncIterableFor([
      { type: 'result', is_error: false, result: '<summary>still billed</summary>' },
    ]) as any);
    await summarizeConversation([makeExchange()], undefined);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('proceeds silently when the user opts in', async () => {
    resetMeteredApiWarningForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
    process.env.EPISODIC_MEMORY_ALLOW_METERED_API = '1';
    vi.mocked(query).mockReturnValueOnce(asyncIterableFor([
      { type: 'result', is_error: false, result: '<summary>opted in</summary>' },
    ]) as any);
    const out = await summarizeConversation([makeExchange()], undefined);
    expect(out).toBe('opted in');
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not guard the subscription path (no key present)', async () => {
    vi.mocked(query).mockReturnValueOnce(asyncIterableFor([
      { type: 'result', is_error: false, result: '<summary>subscription</summary>' },
    ]) as any);
    const out = await summarizeConversation([makeExchange()], undefined);
    expect(out).toBe('subscription');
  });
});
