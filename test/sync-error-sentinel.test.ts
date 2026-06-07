import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the summarizer module so we control whether summarizeConversation throws.
// sync.ts loads summarizer via `await import('./summarizer.js')`, which vi.mock
// intercepts when the mock is registered before sync is loaded.
vi.mock('../src/summarizer.js', async () => {
  const actual = await vi.importActual<typeof import('../src/summarizer.js')>('../src/summarizer.js');
  return {
    ...actual,
    summarizeConversation: vi.fn(),
  };
});

import { syncConversations } from '../src/sync.js';
import { summarizeConversation } from '../src/summarizer.js';
import { ERROR_MARKER, isErroredSentinel, shouldQueueForSummary, formatErrorSentinel, parseSummaryFile } from '../src/summary-sentinel.js';

function makeNonEmptyJsonl(sessionId: string): string {
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

describe('sync command — error-sentinel + retry behavior (#96)', () => {
  let testDir: string;
  let sourceDir: string;
  let destDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-sync-error-test-'));
    sourceDir = join(testDir, 'source');
    destDir = join(testDir, 'dest');
    mkdirSync(sourceDir, { recursive: true });
    vi.mocked(summarizeConversation).mockReset();
    delete process.env.EPISODIC_MEMORY_SUMMARY_ERROR_RETRY_HOURS;
    // Disable the quiescence gate (default 1h idle) so summaries are produced
    // synchronously from fixtures during the test run.
    process.env.EPISODIC_MEMORY_SUMMARY_QUIESCENCE_HOURS = '0';
  });

  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_SUMMARY_ERROR_RETRY_HOURS;
    delete process.env.EPISODIC_MEMORY_SUMMARY_QUIESCENCE_HOURS;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('writes an error sentinel — not empty — when summarizeConversation throws', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const sessionId = '019aff97-5651-71e0-80ec-b4f2c51095c3';
    writeFileSync(join(sourceDir, 'project-a', `${sessionId}.jsonl`), makeNonEmptyJsonl(sessionId), 'utf-8');

    vi.mocked(summarizeConversation).mockRejectedValue(new Error('Simulated API outage'));
    const r1 = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(r1.summarized).toBe(0);
    expect(r1.errors.length).toBe(1);

    const summaryPath = join(destDir, 'project-a', `${sessionId}-summary.txt`);
    expect(existsSync(summaryPath)).toBe(true);
    const content = readFileSync(summaryPath, 'utf-8');
    expect(content.startsWith(`${ERROR_MARKER}\n`)).toBe(true);
    expect(content).toContain('Simulated API outage');
    // Second line should be an ISO timestamp — sanity check that it parses.
    const [, ts] = content.split('\n');
    expect(Number.isFinite(Date.parse(ts))).toBe(true);
  });

  it('does not re-queue an errored file on an immediate second sync (within retry window)', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const sessionId = '019aff97-5651-71e0-80ec-b4f2c51095c3';
    writeFileSync(join(sourceDir, 'project-a', `${sessionId}.jsonl`), makeNonEmptyJsonl(sessionId), 'utf-8');

    vi.mocked(summarizeConversation).mockRejectedValue(new Error('Simulated API outage'));
    await syncConversations(sourceDir, destDir, { skipIndex: true });
    const callsAfterFirst = vi.mocked(summarizeConversation).mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    // Default retry window is 1h — second sync runs immediately, so summarize is not re-invoked.
    const r2 = await syncConversations(sourceDir, destDir, { skipIndex: true });
    expect(vi.mocked(summarizeConversation).mock.calls.length).toBe(callsAfterFirst);
    expect(r2.summarized).toBe(0);
    expect(r2.errors.length).toBe(0);
  });

  it('re-queues an errored file after the retry threshold elapses (allowing transient failures to self-heal)', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const sessionId = '019aff97-5651-71e0-80ec-b4f2c51095c3';
    const jsonlPath = join(sourceDir, 'project-a', `${sessionId}.jsonl`);
    writeFileSync(jsonlPath, makeNonEmptyJsonl(sessionId), 'utf-8');

    // First sync — fails, writes error sentinel.
    vi.mocked(summarizeConversation).mockRejectedValueOnce(new Error('Transient API outage'));
    await syncConversations(sourceDir, destDir, { skipIndex: true });
    const summaryPath = join(destDir, 'project-a', `${sessionId}-summary.txt`);
    expect(isErroredSentinel(readFileSync(summaryPath, 'utf-8'))).toBe(true);

    // Backdate the sentinel's mtime past the default 1h retry window.
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
    utimesSync(summaryPath, twoHoursAgo, twoHoursAgo);

    // Second sync — now the file should be re-attempted. This time it succeeds.
    vi.mocked(summarizeConversation).mockResolvedValueOnce('Recovered summary.');
    const r2 = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(vi.mocked(summarizeConversation).mock.calls.length).toBe(2);
    expect(r2.summarized).toBe(1);
    // Real summaries now carry a __COVERAGE__ header; compare only the body.
    expect(parseSummaryFile(readFileSync(summaryPath, 'utf-8')).body).toBe('Recovered summary.');
  });

  it('respects EPISODIC_MEMORY_SUMMARY_ERROR_RETRY_HOURS for the retry threshold', async () => {
    process.env.EPISODIC_MEMORY_SUMMARY_ERROR_RETRY_HOURS = '0.01'; // 36 seconds
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const sessionId = '019aff97-5651-71e0-80ec-b4f2c51095c3';
    writeFileSync(join(sourceDir, 'project-a', `${sessionId}.jsonl`), makeNonEmptyJsonl(sessionId), 'utf-8');

    vi.mocked(summarizeConversation).mockRejectedValueOnce(new Error('Outage'));
    await syncConversations(sourceDir, destDir, { skipIndex: true });
    const summaryPath = join(destDir, 'project-a', `${sessionId}-summary.txt`);

    // Backdate sentinel by 1 minute — well past the 36-second threshold.
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    utimesSync(summaryPath, oneMinuteAgo, oneMinuteAgo);

    vi.mocked(summarizeConversation).mockResolvedValueOnce('Recovered.');
    const r2 = await syncConversations(sourceDir, destDir, { skipIndex: true });
    expect(r2.summarized).toBe(1);
  });

  it('drains a queue of failing files instead of pinning the head forever', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });

    const fileCount = 12;
    for (let i = 0; i < fileCount; i++) {
      const id = `1111aaaa-1111-1111-1111-${String(i).padStart(12, '0')}`;
      writeFileSync(join(sourceDir, 'project-a', `${id}.jsonl`), makeNonEmptyJsonl(id), 'utf-8');
    }

    vi.mocked(summarizeConversation).mockRejectedValue(new Error('Simulated API outage'));

    // First sync handles 10 (the default summaryLimit), all fail, all get sentinels.
    await syncConversations(sourceDir, destDir, { skipIndex: true });
    const sentinelsAfter1 = readdirSync(join(destDir, 'project-a'))
      .filter(f => f.endsWith('-summary.txt'));
    expect(sentinelsAfter1.length).toBe(10);
    for (const s of sentinelsAfter1) {
      expect(isErroredSentinel(readFileSync(join(destDir, 'project-a', s), 'utf-8'))).toBe(true);
    }

    // Second sync handles the remaining 2 — the first 10 are within the retry window and skipped.
    await syncConversations(sourceDir, destDir, { skipIndex: true });
    const sentinelsAfter2 = readdirSync(join(destDir, 'project-a'))
      .filter(f => f.endsWith('-summary.txt'));
    expect(sentinelsAfter2.length).toBe(fileCount);
  });

  it('leaves empty zero-exchange sentinels alone (does not retry them)', async () => {
    // Regression guard: shouldQueueForSummary must distinguish empty (permanent
    // skip; #91) from __ERRORED__ (transient; retry after threshold).
    const sentinelPath = join(testDir, 'empty-summary.txt');
    writeFileSync(sentinelPath, '', 'utf-8');
    // Byte arg is irrelevant for the empty (permanent-skip) path; pass 0.
    expect(shouldQueueForSummary(sentinelPath, 0)).toBe(false);

    // Even if the empty sentinel is ancient, it must not be re-queued.
    const ancient = new Date(Date.now() - 365 * 24 * 3600_000);
    utimesSync(sentinelPath, ancient, ancient);
    expect(shouldQueueForSummary(sentinelPath, 0)).toBe(false);
  });

  it('formatErrorSentinel + isErroredSentinel round-trip', () => {
    const s = formatErrorSentinel(new Error('boom'));
    expect(isErroredSentinel(s)).toBe(true);
    expect(s).toContain('boom');
    expect(isErroredSentinel('Real summary content.')).toBe(false);
    expect(isErroredSentinel('')).toBe(false);
  });
});

describe('hasRealSummary helper', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-has-real-summary-'));
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('returns true for non-empty, non-marker content', async () => {
    const { hasRealSummary } = await import('../src/summary-sentinel.js');
    const p = join(testDir, 's.txt');
    writeFileSync(p, 'A real summary.', 'utf-8');
    expect(hasRealSummary(p)).toBe(true);
  });

  it('returns false for missing files (#46-style absent sentinel)', async () => {
    const { hasRealSummary } = await import('../src/summary-sentinel.js');
    expect(hasRealSummary(join(testDir, 'missing.txt'))).toBe(false);
  });

  it('returns false for empty zero-exchange sentinels (#91)', async () => {
    const { hasRealSummary } = await import('../src/summary-sentinel.js');
    const p = join(testDir, 'empty.txt');
    writeFileSync(p, '', 'utf-8');
    expect(hasRealSummary(p)).toBe(false);
  });

  it('returns false for error sentinels (#96) — they are not real coverage', async () => {
    const { hasRealSummary } = await import('../src/summary-sentinel.js');
    const p = join(testDir, 'errored.txt');
    writeFileSync(p, formatErrorSentinel(new Error('outage')), 'utf-8');
    expect(hasRealSummary(p)).toBe(false);
  });
});
