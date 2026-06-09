import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  shouldQueueForSummary, hasRealSummary, formatSummaryFile, parseSummaryFile,
  formatErrorSentinel, parseErrorSentinel, isErroredSentinel, needsSummary,
  recordSummaryFailure, getMaxSummaryAttempts, COVERAGE_SCHEMA,
} from '../src/summary-sentinel.js';

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), 'gate-')); dirs.push(d); return d; }
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.EPISODIC_MEMORY_SUMMARY_ERROR_RETRY_HOURS;
  delete process.env.EPISODIC_MEMORY_SUMMARY_MAX_ATTEMPTS;
});

const recentFailure = () => ({ attempts: 1, lastAttempt: Date.now() });

describe('shouldQueueForSummary (growth-aware)', () => {
  it('queues when there is no summary file', () => {
    expect(shouldQueueForSummary(join(tmp(), 's-summary.txt'), 100)).toBe(true);
  });

  it('skips an empty zero-exchange sentinel', () => {
    const p = join(tmp(), 's-summary.txt'); writeFileSync(p, '');
    expect(shouldQueueForSummary(p, 100)).toBe(false);
  });

  it('skips a real summary whose covered bytes equal the current archive size', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatSummaryFile({ bytes: 500, schema: COVERAGE_SCHEMA }, 'Summary'));
    expect(shouldQueueForSummary(p, 500)).toBe(false);
  });

  it('re-queues a real summary when the archive has grown past covered bytes', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatSummaryFile({ bytes: 500, schema: COVERAGE_SCHEMA }, 'Summary'));
    expect(shouldQueueForSummary(p, 900)).toBe(true);
  });

  it('does not re-queue a legacy header-less summary (baseline stamping handles it)', () => {
    const p = join(tmp(), 's-summary.txt'); writeFileSync(p, 'Legacy summary, no header');
    expect(shouldQueueForSummary(p, 900)).toBe(false);
  });

  it('does not retry a recent error sentinel', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatErrorSentinel(new Error('boom'), recentFailure()));
    expect(shouldQueueForSummary(p, 100)).toBe(false);
  });

  it('treats a corrupt coverage header as legacy and does not re-queue', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, '__COVERAGE__ {not json\nSummary body');
    expect(shouldQueueForSummary(p, 9999)).toBe(false);
  });

  it('does not re-queue when the archive is smaller than covered bytes', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatSummaryFile({ bytes: 500, schema: COVERAGE_SCHEMA }, 'Summary'));
    expect(shouldQueueForSummary(p, 300)).toBe(false);
  });

  // --- Unified backoff/give-up: same policy for first-failure sentinels and re-summaries. ---

  it('re-queues an error sentinel once the retry floor has elapsed', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatErrorSentinel(new Error('boom'), { attempts: 1, lastAttempt: Date.now() - 2 * 3600_000 }));
    expect(shouldQueueForSummary(p, 100)).toBe(true);
  });

  it('gives up an error sentinel after the max attempts, even past the floor', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatErrorSentinel(new Error('boom'), { attempts: getMaxSummaryAttempts(), lastAttempt: Date.now() - 999 * 3600_000 }));
    expect(shouldQueueForSummary(p, 100)).toBe(false);
  });

  it('backs off a recently-failed re-summary even though the transcript has grown', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatSummaryFile(
      { bytes: 500, schema: COVERAGE_SCHEMA, resummary: { attempts: 1, lastAttempt: Date.now() } },
      'Summary'));
    // Grown (900 > 500) but the last failure was just now — the 1h floor hasn't elapsed.
    expect(shouldQueueForSummary(p, 900)).toBe(false);
  });

  it('retries a grown re-summary once the retry floor has elapsed', () => {
    const p = join(tmp(), 's-summary.txt');
    const twoHoursAgo = Date.now() - 2 * 3600_000;
    writeFileSync(p, formatSummaryFile(
      { bytes: 500, schema: COVERAGE_SCHEMA, resummary: { attempts: 1, lastAttempt: twoHoursAgo } },
      'Summary'));
    expect(shouldQueueForSummary(p, 900)).toBe(true);
  });

  it('gives up permanently after the max re-summary attempts, keeping the stale summary', () => {
    const p = join(tmp(), 's-summary.txt');
    const longAgo = Date.now() - 999 * 3600_000;
    writeFileSync(p, formatSummaryFile(
      { bytes: 500, schema: COVERAGE_SCHEMA, resummary: { attempts: getMaxSummaryAttempts(), lastAttempt: longAgo } },
      'Summary'));
    // Floor long elapsed and the transcript keeps growing — but the attempt budget is spent.
    expect(shouldQueueForSummary(p, 900)).toBe(false);
    expect(shouldQueueForSummary(p, 100_000)).toBe(false);
  });

  it('honors EPISODIC_MEMORY_SUMMARY_MAX_ATTEMPTS for the give-up threshold (both paths)', () => {
    process.env.EPISODIC_MEMORY_SUMMARY_MAX_ATTEMPTS = '2';
    const longAgo = Date.now() - 999 * 3600_000;
    const errored = join(tmp(), 'e-summary.txt');
    writeFileSync(errored, formatErrorSentinel(new Error('boom'), { attempts: 2, lastAttempt: longAgo }));
    expect(shouldQueueForSummary(errored, 100)).toBe(false);

    const grown = join(tmp(), 'g-summary.txt');
    writeFileSync(grown, formatSummaryFile(
      { bytes: 500, schema: COVERAGE_SCHEMA, resummary: { attempts: 2, lastAttempt: longAgo } },
      'Summary'));
    expect(shouldQueueForSummary(grown, 900)).toBe(false);
  });
});

describe('hasRealSummary', () => {
  it('is true for a stamped summary with a non-empty body', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatSummaryFile({ bytes: 1, schema: COVERAGE_SCHEMA }, 'Real body'));
    expect(hasRealSummary(p)).toBe(true);
  });

  it('is false for a header with an empty body', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatSummaryFile({ bytes: 1, schema: COVERAGE_SCHEMA }, ''));
    expect(hasRealSummary(p)).toBe(false);
  });
});

describe('needsSummary (stat + baseline + growth verdict)', () => {
  it('queues when there is no summary file', () => {
    const dir = tmp();
    const archive = join(dir, 's.jsonl'); writeFileSync(archive, 'x'.repeat(100));
    expect(needsSummary(join(dir, 's-summary.txt'), archive)).toBe(true);
  });

  it('stamps a legacy summary with the current archive size and does not re-queue', () => {
    const dir = tmp();
    const archive = join(dir, 's.jsonl'); writeFileSync(archive, 'x'.repeat(800));
    const summary = join(dir, 's-summary.txt'); writeFileSync(summary, 'Legacy summary, no header');
    expect(needsSummary(summary, archive)).toBe(false);
    expect(parseSummaryFile(readFileSync(summary, 'utf-8')).coverage?.bytes).toBe(800);
  });

  it('re-queues a stamped summary when the archive has grown', () => {
    const dir = tmp();
    const archive = join(dir, 's.jsonl'); writeFileSync(archive, 'x'.repeat(900));
    const summary = join(dir, 's-summary.txt');
    writeFileSync(summary, formatSummaryFile({ bytes: 500, schema: COVERAGE_SCHEMA }, 'Summary'));
    expect(needsSummary(summary, archive)).toBe(true);
  });
});

describe('recordSummaryFailure', () => {
  it('writes an error sentinel when no prior summary exists', () => {
    const p = join(tmp(), 's-summary.txt');
    recordSummaryFailure(p, new Error('boom'));
    expect(isErroredSentinel(readFileSync(p, 'utf-8'))).toBe(true);
  });

  it('increments the error sentinel attempt count across first-failure retries', () => {
    const p = join(tmp(), 's-summary.txt');
    recordSummaryFailure(p, new Error('boom'));
    expect(parseErrorSentinel(readFileSync(p, 'utf-8')).attempts).toBe(1);
    recordSummaryFailure(p, new Error('boom again'));
    expect(parseErrorSentinel(readFileSync(p, 'utf-8')).attempts).toBe(2);
  });

  it('preserves a prior real summary body instead of overwriting it with an error', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatSummaryFile({ bytes: 1, schema: COVERAGE_SCHEMA }, 'Real body'));
    recordSummaryFailure(p, new Error('boom'));
    const content = readFileSync(p, 'utf-8');
    expect(isErroredSentinel(content)).toBe(false);
    expect(parseSummaryFile(content).body).toBe('Real body');
  });

  it('stamps an incrementing re-summary attempt count on the preserved summary', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatSummaryFile({ bytes: 1, schema: COVERAGE_SCHEMA }, 'Real body'));
    recordSummaryFailure(p, new Error('boom'));
    expect(parseSummaryFile(readFileSync(p, 'utf-8')).coverage?.resummary?.attempts).toBe(1);
    recordSummaryFailure(p, new Error('boom again'));
    expect(parseSummaryFile(readFileSync(p, 'utf-8')).coverage?.resummary?.attempts).toBe(2);
  });

  it('keeps the covered byte size unchanged so growth stays the re-queue signal', () => {
    const p = join(tmp(), 's-summary.txt');
    writeFileSync(p, formatSummaryFile({ bytes: 500, schema: COVERAGE_SCHEMA }, 'Real body'));
    recordSummaryFailure(p, new Error('boom'));
    expect(parseSummaryFile(readFileSync(p, 'utf-8')).coverage?.bytes).toBe(500);
  });
});

describe('parseErrorSentinel', () => {
  it('round-trips attempts and lastAttempt', () => {
    const s = formatErrorSentinel(new Error('boom'), { attempts: 3, lastAttempt: 1718000000000 });
    expect(parseErrorSentinel(s)).toEqual({ attempts: 3, lastAttempt: 1718000000000 });
  });

  it('reads a legacy ISO-timestamp sentinel as attempts 0 with the parsed time', () => {
    const iso = '2026-06-07T10:00:00.000Z';
    const parsed = parseErrorSentinel(`__ERRORED__\n${iso}\nboom\n`);
    expect(parsed.attempts).toBe(0);
    expect(parsed.lastAttempt).toBe(Date.parse(iso));
  });
});

describe('getMaxSummaryAttempts', () => {
  it('defaults to 5', () => {
    expect(getMaxSummaryAttempts()).toBe(5);
  });

  it('honors a valid env override', () => {
    process.env.EPISODIC_MEMORY_SUMMARY_MAX_ATTEMPTS = '3';
    expect(getMaxSummaryAttempts()).toBe(3);
  });

  it('falls back to the default for a garbage value', () => {
    process.env.EPISODIC_MEMORY_SUMMARY_MAX_ATTEMPTS = 'nope';
    expect(getMaxSummaryAttempts()).toBe(5);
  });
});
