import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  MIN_CODEX_VERSION,
  parseCodexCliVersion,
  versionMeetsMinimum,
} from '../src/codex-support.js';

describe('Codex support floor', () => {
  it('pins production Codex support to the verified CLI version', () => {
    expect(MIN_CODEX_VERSION).toBe('0.130.0');
  });

  it('parses Codex CLI version output', () => {
    expect(parseCodexCliVersion('codex-cli 0.130.0')).toBe('0.130.0');
    expect(parseCodexCliVersion('codex 1.2.3')).toBe('1.2.3');
    expect(parseCodexCliVersion('unexpected')).toBeUndefined();
  });

  it('compares semantic versions numerically', () => {
    expect(compareSemver('0.130.0', '0.130.0')).toBe(0);
    expect(compareSemver('0.131.0', '0.130.9')).toBeGreaterThan(0);
    expect(compareSemver('0.129.9', '0.130.0')).toBeLessThan(0);
  });

  it('accepts only versions at or above the support floor', () => {
    expect(versionMeetsMinimum('0.130.0')).toBe(true);
    expect(versionMeetsMinimum('0.131.0')).toBe(true);
    expect(versionMeetsMinimum('0.129.9')).toBe(false);
  });
});
