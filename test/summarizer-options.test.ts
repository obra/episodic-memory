import { describe, it, expect, afterEach } from 'vitest';
import {
  buildCodexSummaryPrompt,
  buildCodexSummarizerCommand,
  buildSummarizerQueryOptions,
  getApiEnv,
  shouldSkipReentrantSync
} from '../src/summarizer.js';

describe('buildSummarizerQueryOptions', () => {
  it('sets persistSession: false so the SDK does not write session JSONLs to ~/.claude/projects/ (#83)', () => {
    const opts = buildSummarizerQueryOptions({ model: 'haiku' });
    expect(opts.persistSession).toBe(false);
  });

  it('passes through the model and max_tokens', () => {
    const opts = buildSummarizerQueryOptions({ model: 'haiku' });
    expect(opts.model).toBe('haiku');
    expect(opts.max_tokens).toBe(4096);
  });

  it('includes a systemPrompt on fresh sessions', () => {
    const opts = buildSummarizerQueryOptions({ model: 'haiku' });
    expect(opts.systemPrompt).toBeDefined();
  });

  it('omits systemPrompt when resuming so the original session prompt stays in effect', () => {
    const opts = buildSummarizerQueryOptions({ model: 'haiku', sessionId: 'abc-123' });
    expect(opts.resume).toBe('abc-123');
    expect(opts.systemPrompt).toBeUndefined();
  });
});

describe('buildCodexSummarizerCommand', () => {
  it('resumes the Codex session ephemerally and writes the final message to a file', () => {
    const command = buildCodexSummarizerCommand({
      sessionId: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
      model: 'gpt-5.2',
      prompt: 'Summarize this conversation.',
      outputFile: '/tmp/summary.txt',
      codexBin: 'codex'
    });

    expect(command).toEqual({
      command: 'codex',
      args: [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--output-last-message',
        '/tmp/summary.txt',
        '--model',
        'gpt-5.2',
        'resume',
        '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
        '-'
      ],
      stdin: 'Summarize this conversation.',
      outputFile: '/tmp/summary.txt'
    });
  });
});

describe('buildCodexSummaryPrompt', () => {
  it('instructs Codex to summarize from resumed session context without inspecting files', () => {
    const prompt = buildCodexSummaryPrompt();

    expect(prompt).toContain('resumed Codex session');
    expect(prompt).toContain('reasoning');
    expect(prompt).toContain('Do not inspect files');
    expect(prompt).toContain('<summary>');
  });
});

describe('getApiEnv', () => {
  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_API_BASE_URL;
    delete process.env.EPISODIC_MEMORY_API_TOKEN;
    delete process.env.EPISODIC_MEMORY_API_TIMEOUT_MS;
  });

  it('always sets EPISODIC_MEMORY_SUMMARIZER_GUARD so the SDK subprocess can detect reentrancy (#87)', () => {
    const env = getApiEnv()!;
    expect(env.EPISODIC_MEMORY_SUMMARIZER_GUARD).toBe('1');
  });

  it('routes ANTHROPIC_BASE_URL through to the SDK env when EPISODIC_MEMORY_API_BASE_URL is set', () => {
    process.env.EPISODIC_MEMORY_API_BASE_URL = 'https://example.invalid';
    const env = getApiEnv()!;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid');
  });

  it('routes auth token and timeout through to the SDK env', () => {
    process.env.EPISODIC_MEMORY_API_TOKEN = 'tok-test';
    process.env.EPISODIC_MEMORY_API_TIMEOUT_MS = '12345';
    const env = getApiEnv()!;
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok-test');
    expect(env.API_TIMEOUT_MS).toBe('12345');
  });
});

describe('shouldSkipReentrantSync', () => {
  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD;
  });

  it('returns true when EPISODIC_MEMORY_SUMMARIZER_GUARD is set to "1"', () => {
    process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD = '1';
    expect(shouldSkipReentrantSync()).toBe(true);
  });

  it('returns false when the guard env is unset', () => {
    delete process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD;
    expect(shouldSkipReentrantSync()).toBe(false);
  });

  it('returns false when the guard env is set to anything other than "1"', () => {
    process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD = '0';
    expect(shouldSkipReentrantSync()).toBe(false);
    process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD = 'true';
    expect(shouldSkipReentrantSync()).toBe(false);
  });
});
