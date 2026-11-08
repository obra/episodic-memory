import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ConversationExchange } from '../src/types.js';

// No model loads; no live summarizer calls. The summarizer spy records which
// session ID the indexer asks it to resume.
const { summarizeSpy } = vi.hoisted(() => ({
  summarizeSpy: vi.fn(async () => 'Stub summary.'),
}));
vi.mock('../src/embeddings.js', () => ({
  initEmbeddings: vi.fn(async () => {}),
  generateExchangeEmbedding: vi.fn(async () => new Array(384).fill(0)),
  generateQueryEmbedding: vi.fn(),
  generateEmbedding: vi.fn(),
  initEmbeddingsFailed: false,
}));
vi.mock('../src/summarizer.js', () => ({
  summarizeConversation: summarizeSpy,
}));

import { indexUnprocessed, sessionIdForSummary } from '../src/indexer.js';

const PARENT = '0a1b2c3d-1111-4222-8333-944455556666';

function lines(sessionId: string, isSidechain: boolean, userText: string): string {
  const user = {
    type: 'user', uuid: `u-${userText}`, parentUuid: null, sessionId, isSidechain,
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { role: 'user', content: userText },
  };
  const assistant = {
    type: 'assistant', uuid: `a-${userText}`, parentUuid: `u-${userText}`, sessionId, isSidechain,
    timestamp: '2026-01-01T00:00:01.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: `Answer to: ${userText}` }] },
  };
  return JSON.stringify(user) + '\n' + JSON.stringify(assistant) + '\n';
}

function exchange(overrides: Partial<ConversationExchange>): ConversationExchange {
  return {
    id: 'ex', project: 'p', timestamp: '2026-01-01T00:00:00Z',
    userMessage: 'q', assistantMessage: 'a', archivePath: '/tmp/x.jsonl',
    lineStart: 1, lineEnd: 2, ...overrides,
  };
}

describe('sessionIdForSummary', () => {
  it('returns the session ID for a main-session transcript', () => {
    expect(sessionIdForSummary([exchange({ sessionId: PARENT, isSidechain: false })])).toBe(PARENT);
  });

  it('returns undefined for a subagent transcript, whose lines carry the parent session ID', () => {
    expect(sessionIdForSummary([exchange({ sessionId: PARENT, isSidechain: true })])).toBeUndefined();
  });
});

describe('indexer: subagent transcripts are not summarized by resuming the parent (#205)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-subagent-session-'));
    const projectDir = join(testDir, 'projects', 'project-a');
    mkdirSync(join(projectDir, PARENT, 'subagents'), { recursive: true });
    mkdirSync(join(testDir, 'config'), { recursive: true });
    process.env.TEST_PROJECTS_DIR = join(testDir, 'projects');
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir, 'config');
    process.env.TEST_DB_PATH = join(testDir, 'test.db');

    writeFileSync(join(projectDir, `${PARENT}.jsonl`), lines(PARENT, false, 'Plan the refactor'));
    writeFileSync(
      join(projectDir, PARENT, 'subagents', 'agent-a1b2c3d4e5f6a7b8c.jsonl'),
      lines(PARENT, true, 'You are reviewing Task 5 of the plan')
    );
    summarizeSpy.mockClear();
  });

  afterEach(() => {
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    delete process.env.TEST_DB_PATH;
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('resumes the main session but summarizes the subagent from its transcript text', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await indexUnprocessed(1, false);
    } finally {
      logSpy.mockRestore();
    }

    expect(summarizeSpy).toHaveBeenCalledTimes(2);
    const calls = summarizeSpy.mock.calls as unknown as [ConversationExchange[], string | undefined][];
    const main = calls.find(([ex]) => ex[0].userMessage.includes('Plan the refactor'));
    const sub = calls.find(([ex]) => ex[0].userMessage.includes('You are reviewing Task 5'));
    expect(main?.[1]).toBe(PARENT);
    expect(sub).toBeDefined();
    expect(sub?.[1]).toBeUndefined();
  });
});
