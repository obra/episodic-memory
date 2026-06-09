import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the summarizer so we control the body each sync produces and assert how
// many times it runs. sync.ts loads the summarizer via `await import`, which
// vi.mock intercepts as long as the mock is registered before sync is loaded.
vi.mock('../src/summarizer.js', async () => {
  const actual = await vi.importActual<typeof import('../src/summarizer.js')>('../src/summarizer.js');
  return {
    ...actual,
    summarizeConversation: vi.fn(),
  };
});

import { syncConversations } from '../src/sync.js';
import { summarizeConversation } from '../src/summarizer.js';
import { isErroredSentinel, parseSummaryFile } from '../src/summary-sentinel.js';

// Two exchanges with old timestamps so the conversation is quiescent immediately
// (QUIESCENCE_HOURS=0 means any past timestamp qualifies).
function makeJsonl(sessionId: string): string {
  return [
    JSON.stringify({
      type: 'user',
      uuid: `${sessionId}-user-1`,
      parentUuid: null,
      timestamp: '2025-10-01T12:00:00Z',
      isSidechain: false,
      cwd: '/tmp/test-cwd',
      message: { role: 'user', content: 'What does the deploy script do?' },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: `${sessionId}-asst-1`,
      parentUuid: `${sessionId}-user-1`,
      timestamp: '2025-10-01T12:00:01Z',
      isSidechain: false,
      message: { role: 'assistant', content: [{ type: 'text', text: 'It deploys to prod via terraform apply.' }] },
    }),
  ].join('\n');
}

// Two further exchanges appended to grow the transcript (strictly larger file).
function makeGrowthJsonl(sessionId: string): string {
  return [
    '',
    JSON.stringify({
      type: 'user',
      uuid: `${sessionId}-user-2`,
      parentUuid: `${sessionId}-asst-1`,
      timestamp: '2025-10-01T12:05:00Z',
      isSidechain: false,
      cwd: '/tmp/test-cwd',
      message: { role: 'user', content: 'And how do we roll it back if it breaks?' },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: `${sessionId}-asst-2`,
      parentUuid: `${sessionId}-user-2`,
      timestamp: '2025-10-01T12:05:01Z',
      isSidechain: false,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Run terraform apply against the previous state version.' }] },
    }),
  ].join('\n');
}

describe('sync command — self-healing (growth-driven) re-summary', () => {
  let testDir: string;
  let sourceDir: string;
  let destDir: string;
  const sessionId = '019aff97-5651-71e0-80ec-b4f2c51095c3';

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-sync-resummary-test-'));
    sourceDir = join(testDir, 'source');
    destDir = join(testDir, 'dest');
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    vi.mocked(summarizeConversation).mockReset();
    // Disable the quiescence gate (default 1h idle) so summaries are produced
    // synchronously from fixtures during the test run.
    process.env.EPISODIC_MEMORY_SUMMARY_QUIESCENCE_HOURS = '0';
  });

  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_SUMMARY_QUIESCENCE_HOURS;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  const sourcePath = () => join(sourceDir, 'project-a', `${sessionId}.jsonl`);
  const archiveJsonlPath = () => join(destDir, 'project-a', `${sessionId}.jsonl`);
  const summaryPath = () => join(destDir, 'project-a', `${sessionId}-summary.txt`);

  // copyIfNewer only re-copies when the source mtime is STRICTLY newer than the
  // archive's. In a fast test the two writes can land in the same millisecond, so
  // we force the source's mtime safely into the future to guarantee a re-copy.
  function forceSourceNewer() {
    const future = new Date(Date.now() + 10_000);
    utimesSync(sourcePath(), future, future);
  }

  it('re-summarizes once a grown conversation is synced again', async () => {
    // --- First sync: two exchanges, first summary. ---
    writeFileSync(sourcePath(), makeJsonl(sessionId), 'utf-8');
    vi.mocked(summarizeConversation).mockResolvedValue('First summary.');

    const r1 = await syncConversations(sourceDir, destDir, { skipIndex: true });
    expect(r1.summarized).toBe(1);
    expect(existsSync(summaryPath())).toBe(true);

    const first = parseSummaryFile(readFileSync(summaryPath(), 'utf-8'));
    expect(first.body).toBe('First summary.');
    // Coverage must equal the archived JSONL size so the file is NOT immediately re-queued.
    const archiveBytes1 = statSync(archiveJsonlPath()).size;
    expect(first.coverage?.bytes).toBe(archiveBytes1);

    // --- Grow the source: append two more exchanges. ---
    writeFileSync(sourcePath(), makeJsonl(sessionId) + makeGrowthJsonl(sessionId), 'utf-8');
    const grownSourceBytes = statSync(sourcePath()).size;
    expect(grownSourceBytes).toBeGreaterThan(archiveBytes1);
    // Guarantee a re-copy despite same-millisecond mtimes.
    forceSourceNewer();

    vi.mocked(summarizeConversation).mockResolvedValue('Updated summary.');
    const r2 = await syncConversations(sourceDir, destDir, { skipIndex: true });

    // The archive must have actually grown (proves copyIfNewer re-copied).
    const archiveBytes2 = statSync(archiveJsonlPath()).size;
    expect(archiveBytes2).toBeGreaterThan(archiveBytes1);
    expect(archiveBytes2).toBe(grownSourceBytes);

    // Re-summary happened exactly once more, with the new body and larger coverage.
    expect(vi.mocked(summarizeConversation).mock.calls.length).toBe(2);
    expect(r2.summarized).toBe(1);
    const second = parseSummaryFile(readFileSync(summaryPath(), 'utf-8'));
    expect(second.body).toBe('Updated summary.');
    expect(second.coverage?.bytes).toBe(archiveBytes2);
    expect(second.coverage!.bytes).toBeGreaterThan(first.coverage!.bytes);
  });

  it('does not re-summarize an unchanged conversation on the next sync', async () => {
    writeFileSync(sourcePath(), makeJsonl(sessionId), 'utf-8');
    vi.mocked(summarizeConversation).mockResolvedValue('Stable summary.');

    await syncConversations(sourceDir, destDir, { skipIndex: true });
    expect(vi.mocked(summarizeConversation).mock.calls.length).toBe(1);
    const before = readFileSync(summaryPath(), 'utf-8');

    // Second sync with NO source change — nothing grew, so no re-summary.
    const r2 = await syncConversations(sourceDir, destDir, { skipIndex: true });
    expect(vi.mocked(summarizeConversation).mock.calls.length).toBe(1);
    expect(r2.summarized).toBe(0);

    const after = readFileSync(summaryPath(), 'utf-8');
    expect(after).toBe(before);
  });

  it('preserves the prior summary when a re-summary fails', async () => {
    // --- First sync: good summary. ---
    writeFileSync(sourcePath(), makeJsonl(sessionId), 'utf-8');
    vi.mocked(summarizeConversation).mockResolvedValue('Good summary.');
    await syncConversations(sourceDir, destDir, { skipIndex: true });
    expect(parseSummaryFile(readFileSync(summaryPath(), 'utf-8')).body).toBe('Good summary.');
    const archiveBytes1 = statSync(archiveJsonlPath()).size;

    // --- Grow the source so the file re-queues, then make re-summary fail. ---
    writeFileSync(sourcePath(), makeJsonl(sessionId) + makeGrowthJsonl(sessionId), 'utf-8');
    forceSourceNewer();
    vi.mocked(summarizeConversation).mockRejectedValueOnce(new Error('Outage'));

    const r2 = await syncConversations(sourceDir, destDir, { skipIndex: true });

    // The archive grew (so a re-summary was genuinely attempted) and failed once.
    expect(statSync(archiveJsonlPath()).size).toBeGreaterThan(archiveBytes1);
    expect(vi.mocked(summarizeConversation).mock.calls.length).toBe(2);
    expect(r2.errors.length).toBe(1);

    // The prior real summary is preserved — NOT overwritten with an error sentinel.
    const content = readFileSync(summaryPath(), 'utf-8');
    expect(isErroredSentinel(content)).toBe(false);
    expect(parseSummaryFile(content).body).toBe('Good summary.');

    // ...but the failure is recorded so the growth gate can back off and eventually
    // give up rather than re-attempting on every sync (no-backoff thrash).
    expect(parseSummaryFile(content).coverage?.resummary?.attempts).toBe(1);
  });
});
