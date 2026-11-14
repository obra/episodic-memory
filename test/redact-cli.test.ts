import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const cli = fileURLToPath(new URL('../src/redact-cli.ts', import.meta.url));

describe('redact CLI option validation', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'episodic-redact-cli-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['--rewrite', '--dryrun'],
    ['--stdin', '--rewrite'],
    ['--print-default-rules', '--rewrite'],
    ['--stdin', '--dry-run'],
    ['--dry-run'],
    ['--rewrite', '--report'],
  ])('rejects invalid options %j before touching data', (...args) => {
    const archive = join(root, 'archive');
    mkdirSync(archive);
    const file = join(archive, 'conversation.jsonl');
    const original = JSON.stringify({ password: 'synthetic-value' }) + '\n';
    writeFileSync(file, original);
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, EPISODIC_MEMORY_CONFIG_DIR: join(root, 'config'), TEST_ARCHIVE_DIR: archive, TEST_DB_PATH: join(root, 'index.db') },
      input: '', encoding: 'utf-8', timeout: 10000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unknown option|choose one|requires|needs/);
    expect(readFileSync(file, 'utf-8')).toBe(original);
    expect(readdirSync(root).sort()).toEqual(['archive']);
  });
});
