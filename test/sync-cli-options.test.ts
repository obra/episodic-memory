import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC_CLI = join(REPO_ROOT, 'dist', 'sync-cli.js');

describe('sync-cli options', () => {
  it('fails when --only is missing a harness value', () => {
    const result = spawnSync(process.execPath, [SYNC_CLI, '--only'], {
      env: { ...process.env },
      timeout: 5000,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid --only value');
  });

  it('fails when --summary-limit is missing a numeric value', () => {
    const result = spawnSync(process.execPath, [SYNC_CLI, '--summary-limit', '--only', 'opencode'], {
      env: { ...process.env },
      timeout: 5000,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid --summary-limit value');
  });
});
