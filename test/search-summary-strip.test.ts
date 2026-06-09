import { describe, it, expect } from 'vitest';
import { parseSummaryFile, formatSummaryFile, COVERAGE_SCHEMA } from '../src/summary-sentinel.js';

// The search loader must show the body, never the __COVERAGE__ header line.
describe('search summary display', () => {
  it('parseSummaryFile yields a header-free body for display', () => {
    const file = formatSummaryFile({ bytes: 10, schema: COVERAGE_SCHEMA }, 'Visible summary.');
    expect(parseSummaryFile(file).body.trim()).toBe('Visible summary.');
    expect(parseSummaryFile(file).body).not.toContain('__COVERAGE__');
  });
});
