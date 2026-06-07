import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  shouldQueueForSummary, hasRealSummary, formatSummaryFile, parseSummaryFile,
  formatErrorSentinel, isErroredSentinel, needsSummary, writeErrorSentinelIfNew,
  COVERAGE_SCHEMA,
} from '../src/summary-sentinel.js';

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), 'gate-')); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

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
    writeFileSync(p, formatErrorSentinel(new Error('boom')));
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

describe('writeErrorSentinelIfNew', () => {
  it('writes an error sentinel when no prior summary exists', () => {
    const p = join(tmp(), 's-summary.txt');
    writeErrorSentinelIfNew(p, new Error('boom'));
    expect(isErroredSentinel(readFileSync(p, 'utf-8'))).toBe(true);
  });

  it('preserves a prior real summary instead of overwriting it', () => {
    const p = join(tmp(), 's-summary.txt');
    const good = formatSummaryFile({ bytes: 1, schema: COVERAGE_SCHEMA }, 'Real body');
    writeFileSync(p, good);
    writeErrorSentinelIfNew(p, new Error('boom'));
    expect(readFileSync(p, 'utf-8')).toBe(good);
  });
});
