import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConversationExchange } from '../src/types.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { summarizeConversation } from '../src/summarizer.js';

let testDir: string;
let previousEnv: NodeJS.ProcessEnv;

function exchange(sessionId?: string): ConversationExchange {
  return {
    id: 'codex-summary-fixture',
    project: 'fixture',
    timestamp: '2026-01-01T00:00:00Z',
    userMessage: 'Explain the design and acceptance boundary for this synthetic Codex conversation.',
    assistantMessage: 'The design keeps provider ownership and validates the route with an isolated local app-server fixture.',
    archivePath: path.join(testDir, 'synthetic.jsonl'),
    lineStart: 1,
    lineEnd: 2,
    harness: 'codex',
    ...(sessionId ? { sessionId } : {}),
  };
}

function installFakeCodex(
  failMethod?: 'thread/start' | 'thread/fork',
  options: { ignoreSigterm?: boolean; stalledTurn?: boolean } = {},
): void {
  const executable = path.join(testDir, 'fake-codex');
  fs.writeFileSync(executable, `#!/usr/bin/env node
const readline = require('node:readline');
if (process.argv.includes('--version')) {
  console.log('codex-cli 0.154.0');
  process.exit(0);
}
if (!process.argv.includes('app-server')) process.exit(2);
if (${options.ignoreSigterm === true}) {
  const fs = require('node:fs');
  fs.writeFileSync(${JSON.stringify(path.join(testDir, 'summary-process.json'))}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
  process.on('SIGTERM', () => {
    fs.writeFileSync(${JSON.stringify(path.join(testDir, 'termination-requested'))}, 'SIGTERM');
  });
}
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') emit({ id: message.id, result: {} });
  if (message.method === 'config/read') emit({ id: message.id, result: { config: { mcp_servers: {} } } });
  if (message.method === 'skills/list') emit({ id: message.id, result: { data: [{ skills: [], errors: [] }] } });
  if (message.method === 'thread/start') {
    if (${failMethod === 'thread/start'}) {
      if (${options.ignoreSigterm === true}) {
        emit({ id: message.id, error: { message: 'EXCLUDED_PUBLIC_FIXTURE' } });
        return;
      }
      process.exit(7);
    }
    const params = message.params;
    if (!params.ephemeral || params.threadId || params.sandbox !== 'read-only' ||
        params.allowProviderModelFallback !== false || !params.cwd) process.exit(8);
    emit({ id: message.id, result: { thread: { id: 'ephemeral-summary' } } });
  }
  if (message.method === 'thread/fork') {
    if (${failMethod === 'thread/fork'}) process.exit(7);
    if (message.params.threadId !== 'source-session' || !message.params.ephemeral) process.exit(9);
    emit({ id: message.id, result: { thread: { id: 'forked-summary' } } });
  }
  if (message.method === 'turn/start') {
    if (${options.stalledTurn === true}) return;
    const prompt = message.params.input[0].text;
    if (message.params.threadId === 'ephemeral-summary' &&
        (!prompt.includes('synthetic Codex conversation') || !prompt.includes('isolated local app-server fixture'))) process.exit(10);
    emit({ id: message.id, result: { turn: { id: 'summary-turn' } } });
    emit({ method: 'item/completed', params: { item: { type: 'agentMessage', text: '<summary>Codex kept provider ownership.</summary>' } } });
    emit({ method: 'turn/completed', params: { turn: { id: 'summary-turn', status: 'completed' } } });
  }
});
`);
  fs.chmodSync(executable, 0o700);
  process.env.EPISODIC_MEMORY_CODEX_BIN = executable;
}

beforeEach(() => {
  previousEnv = { ...process.env };
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-summary-routing-'));
  process.env.EPISODIC_MEMORY_CONFIG_DIR = path.join(testDir, 'config');
  vi.mocked(query).mockReset();
  vi.mocked(query).mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield { type: 'result', is_error: false, result: '<summary>Wrong provider.</summary>' };
    },
  } as any);
});

afterEach(() => {
  process.env = previousEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('Codex summary provider ownership', () => {
  it.skipIf(process.platform === 'win32').each(['completed', 'failed', 'timed out'] as const)(
    'terminates a SIGTERM-resistant isolated summary after the turn %s',
    async status => {
      installFakeCodex(status === 'failed' ? 'thread/start' : undefined, {
        ignoreSigterm: true,
        stalledTurn: status === 'timed out',
      });
      if (status === 'timed out') process.env.EPISODIC_MEMORY_CODEX_SUMMARY_TIMEOUT_MS = '256';
      let settled = false;
      const outcome = summarizeConversation([exchange()]).then(
        result => { settled = true; return { status: 'resolved' as const, result }; },
        error => { settled = true; return { status: 'rejected' as const, error }; },
      );
      let deadline: NodeJS.Timeout | undefined;
      const expired = new Promise<{ status: 'expired' }>(resolve => {
        deadline = setTimeout(() => resolve({ status: 'expired' }), 5000);
      });

      try {
        const result = await Promise.race([outcome, expired]);
        expect(result.status).toBe(status === 'completed' ? 'resolved' : 'rejected');
        if (result.status === 'resolved') {
          expect(result.result).toBe('Codex kept provider ownership.');
        } else if (result.status === 'rejected') {
          expect(result.error.message).toBe('Isolated Codex summary failed; provider details suppressed');
        }
        const child = JSON.parse(fs.readFileSync(path.join(testDir, 'summary-process.json'), 'utf8'));
        expect(fs.existsSync(path.join(testDir, 'termination-requested'))).toBe(true);
        expect(fs.existsSync(child.cwd)).toBe(false);
        expect(() => process.kill(child.pid, 0)).toThrow();
        expect(query).not.toHaveBeenCalled();
      } finally {
        if (deadline) clearTimeout(deadline);
        const marker = path.join(testDir, 'summary-process.json');
        if (!settled && fs.existsSync(marker)) {
          const child = JSON.parse(fs.readFileSync(marker, 'utf8'));
          try { process.kill(child.pid, 'SIGKILL'); } catch {}
          await outcome;
          fs.rmSync(child.cwd, { recursive: true, force: true });
        }
      }
    },
  );

  it('summarizes a sessionless Codex transcript in an isolated ephemeral Codex thread', async () => {
    installFakeCodex();

    expect(await summarizeConversation([exchange()])).toBe('Codex kept provider ownership.');
    expect(query).not.toHaveBeenCalled();
  });

  it('does not borrow another harness session ID for a sessionless Codex exchange', async () => {
    installFakeCodex();
    const otherHarness: ConversationExchange = {
      ...exchange('other-provider-session'),
      id: 'other-provider-exchange',
      harness: 'claude',
    };

    expect(await summarizeConversation([otherHarness, exchange()]))
      .toBe('Codex kept provider ownership.');
    expect(query).not.toHaveBeenCalled();
  });

  it('does not fall back to Claude when a sessionless Codex summary fails', async () => {
    installFakeCodex('thread/start');

    await expect(summarizeConversation([exchange()]))
      .rejects.toThrow('Isolated Codex summary failed; provider details suppressed');
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps the ephemeral fork for a Codex transcript with a session ID', async () => {
    installFakeCodex();

    expect(await summarizeConversation([exchange('source-session')]))
      .toBe('Codex kept provider ownership.');
    expect(query).not.toHaveBeenCalled();
  });

  it('uses only admitted Codex text when source-session resume is disabled', async () => {
    installFakeCodex('thread/fork');

    expect(await summarizeConversation([exchange('source-session')], 'source-session', { allowResume: false }))
      .toBe('Codex kept provider ownership.');
    expect(query).not.toHaveBeenCalled();
  });

  it('uses only transcript text when Claude source-session resume is disabled', async () => {
    const transcript = { ...exchange('source-session'), harness: 'claude' as const };

    expect(await summarizeConversation([transcript], 'source-session', { allowResume: false }))
      .toBe('Wrong provider.');
    const [request] = vi.mocked(query).mock.calls[0];
    expect(request.options?.resume).toBeUndefined();
    expect(request.prompt).toContain(transcript.userMessage);
    expect(request.prompt).toContain(transcript.assistantMessage);
  });

  it('does not fall back to Claude when a Codex fork fails', async () => {
    installFakeCodex('thread/fork');

    await expect(summarizeConversation([exchange('source-session')]))
      .rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
