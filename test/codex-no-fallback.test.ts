import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConversationExchange } from '../src/types.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
import { query } from '@anthropic-ai/claude-agent-sdk';
import { summarizeConversation } from '../src/summarizer.js';

describe('Codex summary provider boundary', () => {
  let directory: string;
  let previous: NodeJS.ProcessEnv;

  beforeEach(() => {
    previous = { ...process.env };
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'em-codex-no-fallback-'));
    process.env.EPISODIC_MEMORY_CONFIG_DIR = directory;
    process.env.EPISODIC_MEMORY_CODEX_BIN = path.join(directory, 'missing-codex');
    vi.mocked(query).mockReset();
  });

  afterEach(() => {
    process.env = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('does not call Claude when Codex app-server is unavailable', async () => {
    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result', is_error: false, result: '<summary>Unexpected Claude fallback.</summary>' };
      },
    } as any);
    const exchange: ConversationExchange = {
      id: 'codex-1', project: 'fixture', timestamp: '2026-01-01T00:00:00Z',
      userMessage: 'Explain the design decisions behind the memory index and the safe summary route in this project.',
      assistantMessage: 'The index uses line high-water marks and summaries are generated only after provider admission.',
      archivePath: path.join(directory, 'session.jsonl'), lineStart: 1, lineEnd: 2,
      harness: 'codex', sessionId: '00000000-1111-4222-8333-444444444444',
    };

    await expect(summarizeConversation([exchange], exchange.sessionId)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps a Codex transcript without a session ID on the Codex route', async () => {
    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result', is_error: false, result: '<summary>Unexpected Claude fallback.</summary>' };
      },
    } as any);
    const exchange: ConversationExchange = {
      id: 'codex-no-id', project: 'fixture', timestamp: '2026-01-01T00:00:00Z',
      userMessage: 'Explain the design decisions behind the memory index and the safe summary route in this project.',
      assistantMessage: 'The index uses line high-water marks and summaries are generated only after provider admission.',
      archivePath: path.join(directory, 'session.jsonl'), lineStart: 1, lineEnd: 2,
      harness: 'codex',
    };

    await expect(summarizeConversation([exchange])).rejects.toThrow(/session ID/);
    expect(query).not.toHaveBeenCalled();
  });
});
