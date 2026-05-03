import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC_CLI = join(REPO_ROOT, 'dist', 'sync-cli.js');

describe('sync-cli reentrancy guard (#87)', () => {
  it('exits 0 silently when EPISODIC_MEMORY_SUMMARIZER_GUARD=1', () => {
    const result = spawnSync(process.execPath, [SYNC_CLI], {
      env: { ...process.env, EPISODIC_MEMORY_SUMMARIZER_GUARD: '1' },
      timeout: 5000,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    // The guard message goes to stderr, normal sync output to stdout.
    expect(result.stderr).toMatch(/skipping sync.*subprocess/i);
    expect(result.stdout).not.toMatch(/Syncing conversations/);
  });

  it('also bails out when the guard is set together with --background', () => {
    // Without the guard, --background would fork a detached child.
    // With the guard, we should exit before reaching the spawn() call.
    const result = spawnSync(process.execPath, [SYNC_CLI, '--background'], {
      env: { ...process.env, EPISODIC_MEMORY_SUMMARIZER_GUARD: '1' },
      timeout: 5000,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/Sync started in background/);
  });
});
