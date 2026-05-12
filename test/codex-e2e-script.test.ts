import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(import.meta.dirname, '..');

describe('Codex E2E test harness', () => {
  it('exposes an opt-in npm script', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.scripts['test:codex-e2e']).toBe('node scripts/codex-e2e.js');
  });

  it('contains the production Codex plugin workflow checks', () => {
    const scriptPath = join(REPO_ROOT, 'scripts/codex-e2e.js');
    expect(existsSync(scriptPath)).toBe(true);

    const script = readFileSync(scriptPath, 'utf-8');
    expect(script).toContain('EPISODIC_MEMORY_RUN_CODEX_E2E');
    expect(script).toContain('tmux');
    expect(script).toContain('hooks/list');
    expect(script).toContain('FOUND_MEMORY_E2E');
    expect(script).toContain('MIN_CODEX_VERSION');
  });
});
