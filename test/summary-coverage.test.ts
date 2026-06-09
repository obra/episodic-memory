import { describe, it, expect, afterEach } from 'vitest';
import { formatSummaryFile, parseSummaryFile, COVERAGE_SCHEMA, writeSummary, ensureCoverageBaseline, formatErrorSentinel } from '../src/summary-sentinel.js';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('summary coverage codec', () => {
  it('round-trips a coverage header and body', () => {
    const cov = { bytes: 48213, lastExchange: '2026-06-07T14:03:22Z', schema: COVERAGE_SCHEMA };
    const file = formatSummaryFile(cov, 'A short summary.');
    expect(file.startsWith('__COVERAGE__ ')).toBe(true);
    const { coverage, body } = parseSummaryFile(file);
    expect(coverage).toEqual(cov);
    expect(body).toBe('A short summary.');
  });

  it('treats a header-less file as legacy (no coverage, whole content is body)', () => {
    const { coverage, body } = parseSummaryFile('Legacy summary text.');
    expect(coverage).toBeNull();
    expect(body).toBe('Legacy summary text.');
  });

  it('strips a corrupt header line rather than leaking it into the body', () => {
    const { coverage, body } = parseSummaryFile('__COVERAGE__ {not json\nThe summary.');
    expect(coverage).toBeNull();
    expect(body).toBe('The summary.');
  });

  it('parses a header with no trailing newline as an empty body', () => {
    const { coverage, body } = parseSummaryFile('__COVERAGE__ {"bytes":10,"schema":1}');
    expect(coverage).toEqual({ bytes: 10, schema: 1 });
    expect(body).toBe('');
  });

  it('round-trips a multi-line body', () => {
    const cov = { bytes: 1, schema: COVERAGE_SCHEMA };
    const body = 'Line one.\nLine two.\n\nLine four.';
    expect(parseSummaryFile(formatSummaryFile(cov, body)).body).toBe(body);
  });
});

describe('writeSummary + ensureCoverageBaseline', () => {
  const tmpDirs: string[] = [];
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'cov-')); tmpDirs.push(d); return d; };
  afterEach(() => { for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it('writes a summary stamped with the archive byte size and last timestamp', () => {
    const dir = tmp();
    const jsonl = join(dir, 's.jsonl');
    writeFileSync(jsonl, 'x'.repeat(500));
    const summaryPath = join(dir, 's-summary.txt');
    const exchanges = [{ timestamp: '2026-06-07T10:00:00Z' }, { timestamp: '2026-06-07T11:00:00Z' }] as any;
    writeSummary(summaryPath, jsonl, exchanges, 'The summary body.');
    const { coverage, body } = parseSummaryFile(readFileSync(summaryPath, 'utf-8'));
    expect(coverage?.bytes).toBe(statSync(jsonl).size);
    expect(coverage?.lastExchange).toBe('2026-06-07T11:00:00Z');
    expect(body).toBe('The summary body.');
  });

  it('stamps a legacy header-less summary with current bytes and no LLM, preserving the body', () => {
    const dir = tmp();
    const jsonl = join(dir, 's.jsonl');
    writeFileSync(jsonl, 'y'.repeat(800));
    const summaryPath = join(dir, 's-summary.txt');
    writeFileSync(summaryPath, 'Old legacy summary.');
    ensureCoverageBaseline(summaryPath, statSync(jsonl).size);
    const { coverage, body } = parseSummaryFile(readFileSync(summaryPath, 'utf-8'));
    expect(coverage?.bytes).toBe(800);
    expect(body).toBe('Old legacy summary.');
  });

  it('leaves an already-stamped file untouched', () => {
    const summaryPath = join(tmp(), 's-summary.txt');
    const stamped = formatSummaryFile({ bytes: 10, schema: COVERAGE_SCHEMA }, 'Body');
    writeFileSync(summaryPath, stamped);
    ensureCoverageBaseline(summaryPath, 999);
    expect(readFileSync(summaryPath, 'utf-8')).toBe(stamped);
  });

  it('leaves an empty zero-exchange sentinel untouched', () => {
    const summaryPath = join(tmp(), 's-summary.txt');
    writeFileSync(summaryPath, '');
    ensureCoverageBaseline(summaryPath, 999);
    expect(readFileSync(summaryPath, 'utf-8')).toBe('');
  });

  it('leaves an error sentinel untouched', () => {
    const summaryPath = join(tmp(), 's-summary.txt');
    const errored = formatErrorSentinel(new Error('boom'), { attempts: 1, lastAttempt: Date.now() });
    writeFileSync(summaryPath, errored);
    ensureCoverageBaseline(summaryPath, 999);
    expect(readFileSync(summaryPath, 'utf-8')).toBe(errored);
  });
});
