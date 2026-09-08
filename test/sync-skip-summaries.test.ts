import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the summarizer so the test can assert it is never reached.
// sync.ts loads it via `await import('./summarizer.js')`, which vi.mock
// intercepts when the mock is registered before sync is loaded.
vi.mock('../src/summarizer.js', async () => {
  const actual = await vi.importActual<typeof import('../src/summarizer.js')>('../src/summarizer.js');
  return {
    ...actual,
    summarizeConversation: vi.fn(),
  };
});

import { buildSyncOptionsFromEnv, syncConversations } from '../src/sync.js';
import { summarizeConversation } from '../src/summarizer.js';

const SESSION_ID = '019b0d21-4c4e-7a11-9f3a-2c6a1e5b8d40';

function makeNonEmptyJsonl(sessionId: string): string {
  return [
    JSON.stringify({
      type: 'user',
      uuid: `${sessionId}-user-1`,
      parentUuid: null,
      timestamp: '2025-10-01T12:00:00Z',
      isSidechain: false,
      cwd: '/tmp/test-cwd',
      message: { role: 'user', content: 'How does the sync command work?' },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: `${sessionId}-asst-1`,
      parentUuid: `${sessionId}-user-1`,
      timestamp: '2025-10-01T12:00:01Z',
      isSidechain: false,
      message: { role: 'assistant', content: [{ type: 'text', text: 'It copies, indexes, then summarizes.' }] },
    }),
  ].join('\n');
}

describe('buildSyncOptionsFromEnv', () => {
  it('enables skipSummaries when EPISODIC_MEMORY_SKIP_SUMMARIES is exactly "1"', () => {
    const options = buildSyncOptionsFromEnv({ EPISODIC_MEMORY_SKIP_SUMMARIES: '1' } as NodeJS.ProcessEnv);
    expect(options.skipSummaries).toBe(true);
  });

  it('leaves summarization on when the variable is unset', () => {
    expect(buildSyncOptionsFromEnv({} as NodeJS.ProcessEnv).skipSummaries).toBe(false);
  });

  it('leaves summarization on for values other than "1"', () => {
    for (const value of ['0', 'true', 'yes', '', ' 1', '1 ']) {
      const options = buildSyncOptionsFromEnv({ EPISODIC_MEMORY_SKIP_SUMMARIES: value } as NodeJS.ProcessEnv);
      expect(options.skipSummaries, `value: ${JSON.stringify(value)}`).toBe(false);
    }
  });
});

describe('sync command — EPISODIC_MEMORY_SKIP_SUMMARIES', () => {
  let testDir: string;
  let sourceDir: string;
  let destDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-skip-summaries-test-'));
    sourceDir = join(testDir, 'source');
    destDir = join(testDir, 'dest');
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    writeFileSync(join(sourceDir, 'project-a', `${SESSION_ID}.jsonl`), makeNonEmptyJsonl(SESSION_ID), 'utf-8');
    vi.mocked(summarizeConversation).mockReset();
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('writes no summary sidecar and never calls the summarizer when skipSummaries is set', async () => {
    const options = buildSyncOptionsFromEnv({ EPISODIC_MEMORY_SKIP_SUMMARIES: '1' } as NodeJS.ProcessEnv);
    const result = await syncConversations(sourceDir, destDir, { ...options, skipIndex: true });

    expect(result.copied).toBe(1);
    expect(result.summarized).toBe(0);
    expect(result.errors).toEqual([]);
    expect(vi.mocked(summarizeConversation)).not.toHaveBeenCalled();

    const sidecars = readdirSync(join(destDir, 'project-a')).filter(f => f.endsWith('-summary.txt'));
    expect(sidecars).toEqual([]);
  });

  it('still summarizes the same conversation when the variable is absent', async () => {
    vi.mocked(summarizeConversation).mockResolvedValue('A summary of the conversation.');

    const options = buildSyncOptionsFromEnv({} as NodeJS.ProcessEnv);
    const result = await syncConversations(sourceDir, destDir, { ...options, skipIndex: true });

    expect(result.summarized).toBe(1);
    expect(vi.mocked(summarizeConversation)).toHaveBeenCalledTimes(1);
    expect(existsSync(join(destDir, 'project-a', `${SESSION_ID}-summary.txt`))).toBe(true);
  });
});
