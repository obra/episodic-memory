import { describe, it, expect, afterEach } from 'vitest';
import { getQuiescenceMs, isQuiescent } from '../src/summary-sentinel.js';

const ENV = 'EPISODIC_MEMORY_SUMMARY_QUIESCENCE_HOURS';
afterEach(() => { delete process.env[ENV]; });

describe('quiescence', () => {
  it('defaults to one hour', () => {
    expect(getQuiescenceMs()).toBe(3600_000);
  });

  it('honors the env override, including 0 (no wait)', () => {
    process.env[ENV] = '2';
    expect(getQuiescenceMs()).toBe(7200_000);
    process.env[ENV] = '0';
    expect(getQuiescenceMs()).toBe(0);
  });

  it('falls back to the default for a non-positive/garbage value', () => {
    process.env[ENV] = 'nope';
    expect(getQuiescenceMs()).toBe(3600_000);
    process.env[ENV] = '-1';
    expect(getQuiescenceMs()).toBe(3600_000);
  });

  it('is quiescent only when the last exchange is older than the threshold', () => {
    const now = 1_000_000_000_000;
    const recent = [{ timestamp: new Date(now - 60_000).toISOString() }] as any;
    const old = [{ timestamp: new Date(now - 7200_000).toISOString() }] as any;
    expect(isQuiescent(recent, now)).toBe(false);
    expect(isQuiescent(old, now)).toBe(true);
  });

  it('treats a missing/unparseable last timestamp as quiescent (cannot tell, do not block)', () => {
    expect(isQuiescent([], 1_000_000_000_000)).toBe(true);
    expect(isQuiescent([{ timestamp: 'garbage' }] as any, 1_000_000_000_000)).toBe(true);
  });

  it('treats an exchange aged exactly the threshold as quiescent (>= boundary)', () => {
    const now = 1_000_000_000_000;
    const atThreshold = [{ timestamp: new Date(now - 3600_000).toISOString() }] as any;
    const justUnder = [{ timestamp: new Date(now - 3600_000 + 1).toISOString() }] as any;
    expect(isQuiescent(atThreshold, now)).toBe(true);
    expect(isQuiescent(justUnder, now)).toBe(false);
  });
});
