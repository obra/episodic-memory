import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildCodexSummaryPrompt,
  buildCodexSummarizerCommand,
  buildSummarizerQueryOptions,
  getApiEnv,
  getCodexModel,
  isResumeFailure,
  runCodexCommand,
  shouldSkipReentrantSync,
  SummarizerSdkError
} from '../src/summarizer.js';
import { ConversationExchange } from '../src/types.js';

describe('buildSummarizerQueryOptions', () => {
  it('sets persistSession: false so the SDK does not write session JSONLs to ~/.claude/projects/ (#83)', () => {
    const opts = buildSummarizerQueryOptions({ model: 'haiku' });
    expect(opts.persistSession).toBe(false);
  });

  it('sets strictMcpConfig: true so summarizer subprocesses do not launch the user\'s MCP servers', () => {
    const opts = buildSummarizerQueryOptions({ model: 'haiku' });
    expect(opts.strictMcpConfig).toBe(true);
    const resumeOpts = buildSummarizerQueryOptions({ model: 'haiku', sessionId: 'abc-123' });
    expect(resumeOpts.strictMcpConfig).toBe(true);
  });

  it('sets settingSources: [] so summarizer subprocesses load no user settings, plugins, or hooks', () => {
    const opts = buildSummarizerQueryOptions({ model: 'haiku' });
    expect(opts.settingSources).toEqual([]);
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

  it('passes cwd through to the SDK so resume looks up the session under the correct project dir', () => {
    // The session's cwd must exist on disk for the option to be honored.
    const realCwd = mkdtempSync(join(tmpdir(), 'episodic-memory-cwd-test-'));
    try {
      const opts = buildSummarizerQueryOptions({ model: 'haiku', sessionId: 'abc-123', cwd: realCwd });
      expect(opts.cwd).toBe(realCwd);
    } finally {
      rmSync(realCwd, { recursive: true, force: true });
    }
  });

  it('omits cwd when the session\'s recorded cwd no longer exists on disk', () => {
    const opts = buildSummarizerQueryOptions({
      model: 'haiku',
      sessionId: 'abc-123',
      cwd: '/nonexistent/path/that/definitely/does/not/exist'
    });
    expect(opts.cwd).toBeUndefined();
  });

  it('omits cwd when not provided', () => {
    const opts = buildSummarizerQueryOptions({ model: 'haiku', sessionId: 'abc-123' });
    expect(opts.cwd).toBeUndefined();
  });

  // tools: [] strips every built-in tool so a resumed mid-task session can't keep
  // executing the task instead of summarizing.
  it('disables all built-in tools via tools: [] so a resumed mid-task session cannot execute the task', () => {
    const opts = buildSummarizerQueryOptions({ model: 'haiku', sessionId: 'abc-123' });
    expect(opts.tools).toEqual([]);
  });

  it('applies the tool restriction on fresh (non-resume) sessions too, not only when resuming', () => {
    const opts = buildSummarizerQueryOptions({ model: 'haiku' });
    expect(opts.tools).toEqual([]);
  });
});

describe('isResumeFailure', () => {
  it('matches SummarizerSdkError with subtype error_during_execution (the SDK\'s signal for resume lookup failure)', () => {
    expect(isResumeFailure(new SummarizerSdkError('error_during_execution'))).toBe(true);
    expect(isResumeFailure(new SummarizerSdkError('error_during_execution', 'session-id-x'))).toBe(true);
  });

  it('does not match SummarizerSdkError with other subtypes', () => {
    expect(isResumeFailure(new SummarizerSdkError('auth_failed'))).toBe(false);
    expect(isResumeFailure(new SummarizerSdkError('rate_limit'))).toBe(false);
    expect(isResumeFailure(new SummarizerSdkError('unknown'))).toBe(false);
  });

  it('does not match plain Error or non-Error values, even if their text looks resume-related', () => {
    expect(isResumeFailure(new Error('No conversation found with session ID: abc'))).toBe(false);
    expect(isResumeFailure(new Error('error_during_execution'))).toBe(false);
    expect(isResumeFailure('No conversation found')).toBe(false);
    expect(isResumeFailure(undefined)).toBe(false);
    expect(isResumeFailure(null)).toBe(false);
  });
});

describe('buildCodexSummarizerCommand', () => {
  it('starts the Codex app-server so the summarizer can fork ephemerally', () => {
    const command = buildCodexSummarizerCommand({
      sessionId: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
      model: 'gpt-5.2',
      prompt: 'Summarize this conversation.',
      codexBin: 'codex'
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['app-server'],
      prompt: 'Summarize this conversation.',
      sessionId: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
      model: 'gpt-5.2'
    });
  });
});

describe('runCodexCommand', () => {
  it('forks the session ephemerally and returns the completed agent message', async () => {
    const fakeAppServer = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', line => {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          console.log(JSON.stringify({ id: message.id, result: { userAgent: 'fake', codexHome: '/tmp/codex', platformFamily: 'unix', platformOs: 'macos' } }));
          return;
        }
        if (message.method === 'initialized') return;
        if (message.method === 'thread/fork') {
          if (message.params.threadId !== 'session-123') throw new Error('wrong session id');
          if (message.params.ephemeral !== true) throw new Error('fork was not ephemeral');
          if (message.params.sandbox !== 'read-only') throw new Error('fork was not read-only');
          console.log(JSON.stringify({ id: message.id, result: { thread: { id: 'fork-456' } } }));
          return;
        }
        if (message.method === 'turn/start') {
          if (message.params.threadId !== 'fork-456') throw new Error('turn did not target fork');
          if (!message.params.input[0].text.includes('Summarize this conversation')) throw new Error('wrong prompt');
          console.log(JSON.stringify({ id: message.id, result: { turn: { id: 'turn-789', status: 'inProgress' } } }));
          console.log(JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: '<summary>Codex fork summary.</summary>' } }));
          console.log(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-789', status: 'completed' } } }));
        }
      });
    `;

    const result = await runCodexCommand({
      command: process.execPath,
      args: ['-e', fakeAppServer],
      sessionId: 'session-123',
      prompt: 'Summarize this conversation.',
      skipVersionCheck: true,
    });

    expect(result).toBe('<summary>Codex fork summary.</summary>');
  });

  it('rejects Codex versions below the production support floor before starting app-server', async () => {
    await expect(runCodexCommand({
      command: process.execPath,
      versionArgs: ['-e', "console.log('codex-cli 0.129.9')"],
      args: ['-e', 'setTimeout(() => {}, 1000)'],
      sessionId: 'session-123',
      prompt: 'Summarize this conversation.',
    })).rejects.toThrow(/requires codex-cli >= 0\.130\.0; found 0\.129\.9/);
  });

  it('reports malformed app-server fork responses clearly', async () => {
    const fakeAppServer = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', line => {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          console.log(JSON.stringify({ id: message.id, result: {} }));
          return;
        }
        if (message.method === 'initialized') return;
        if (message.method === 'thread/fork') {
          console.log(JSON.stringify({ id: message.id, result: {} }));
        }
      });
    `;

    await expect(runCodexCommand({
      command: process.execPath,
      args: ['-e', fakeAppServer],
      sessionId: 'session-123',
      prompt: 'Summarize this conversation.',
      skipVersionCheck: true,
    })).rejects.toThrow(/thread\/fork returned unexpected response/);
  });
});

describe('getCodexModel', () => {
  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_CODEX_MODEL;
  });

  const codexExchange = (model?: string): ConversationExchange => ({
    id: 'ex-1',
    project: 'test',
    timestamp: '2026-04-01T00:00:00Z',
    userMessage: 'hi',
    assistantMessage: 'hello',
    archivePath: '/tmp/test.jsonl',
    lineStart: 1,
    lineEnd: 2,
    harness: 'codex',
    model,
  });

  it('returns undefined by default so app-server falls back to ~/.codex/config.toml#model', () => {
    expect(getCodexModel([codexExchange('gpt-5.2-codex')])).toBeUndefined();
  });

  it('ignores deprecated model ids baked into historical exchanges (#98)', () => {
    // pre-deprecation Codex sessions carry model: "gpt-5.2-codex"; forcing that
    // into thread/fork returns 400 "model is not supported".
    expect(getCodexModel([codexExchange('gpt-5.2-codex')])).toBeUndefined();
  });

  it('honors EPISODIC_MEMORY_CODEX_MODEL when operators want a specific model', () => {
    process.env.EPISODIC_MEMORY_CODEX_MODEL = 'gpt-5.5-codex';
    expect(getCodexModel([codexExchange('gpt-5.2-codex')])).toBe('gpt-5.5-codex');
  });

  it('treats an empty EPISODIC_MEMORY_CODEX_MODEL the same as unset', () => {
    process.env.EPISODIC_MEMORY_CODEX_MODEL = '';
    expect(getCodexModel([codexExchange('gpt-5.2-codex')])).toBeUndefined();
  });
});

describe('buildCodexSummaryPrompt', () => {
  it('instructs Codex to summarize from forked session context without inspecting files', () => {
    const prompt = buildCodexSummaryPrompt();

    expect(prompt).toContain('ephemeral Codex fork');
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
