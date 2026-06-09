import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { orderFreshBeforeRetry } from '../src/sync.js';
import { formatSummaryFile, COVERAGE_SCHEMA } from '../src/summary-sentinel.js';

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), 'queue-order-')); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

// A conversation is a "re-summary" when its -summary.txt already holds a real
// body; those must sort AFTER never-summarized ones so a backlog of failing
// re-summaries can't starve fresh work out of the per-run summaryLimit (#91).
function writeGoodSummary(jsonlPath: string): void {
  writeFileSync(jsonlPath.replace('.jsonl', '-summary.txt'),
    formatSummaryFile({ bytes: 1, schema: COVERAGE_SCHEMA }, 'Existing summary'));
}

describe('orderFreshBeforeRetry', () => {
  it('puts never-summarized conversations ahead of re-summary retries', () => {
    const dir = tmp();
    const fresh = { path: join(dir, 'fresh.jsonl'), sessionId: 'f' };
    const retry = { path: join(dir, 'retry.jsonl'), sessionId: 'r' };
    writeFileSync(fresh.path, '{}');
    writeFileSync(retry.path, '{}');
    writeGoodSummary(retry.path);

    // Input deliberately retry-first; output must be fresh-first.
    const ordered = orderFreshBeforeRetry([retry, fresh]);
    expect(ordered.map(f => f.sessionId)).toEqual(['f', 'r']);
  });

  it('preserves discovery order within each group (stable)', () => {
    const dir = tmp();
    const items = ['f1', 'f2', 'r1', 'r2'].map(id => ({ path: join(dir, `${id}.jsonl`), sessionId: id }));
    for (const f of items) writeFileSync(f.path, '{}');
    writeGoodSummary(items[2].path); // r1
    writeGoodSummary(items[3].path); // r2

    const ordered = orderFreshBeforeRetry([items[0], items[2], items[1], items[3]]); // f1, r1, f2, r2
    expect(ordered.map(f => f.sessionId)).toEqual(['f1', 'f2', 'r1', 'r2']);
  });
});
