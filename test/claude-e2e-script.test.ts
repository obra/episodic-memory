import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(import.meta.dirname, '..');

describe('Claude E2E test harness', () => {
  it('exposes an opt-in npm script', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.scripts['test:claude-e2e']).toBe('node scripts/claude-e2e.js');
  });

  it('contains the production Claude plugin workflow checks', () => {
    const scriptPath = join(REPO_ROOT, 'scripts/claude-e2e.js');
    expect(existsSync(scriptPath)).toBe(true);

    const script = readFileSync(scriptPath, 'utf-8');
    expect(script).toContain('EPISODIC_MEMORY_RUN_CLAUDE_E2E');
    expect(script).toContain('CLAUDE_BIN');
    expect(script).toContain('TEST_PROJECTS_DIR');
    expect(script).toContain('--plugin-dir');
    expect(script).toContain('FOUND_CLAUDE_MEMORY_E2E');
    expect(script).toContain('mcp__plugin_episodic-memory_episodic-memory__search');
  });
});
