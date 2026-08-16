import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC_CLI = join(REPO_ROOT, 'dist', 'sync-cli.js');

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runWith(env: Record<string, string>): RunResult {
  const result = spawnSync(process.execPath, [SYNC_CLI], {
    env: { ...process.env, ...env, EPISODIC_MEMORY_SUMMARIZER_GUARD: undefined as any },
    timeout: 30_000,
    encoding: 'utf-8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function spawnWith(env: Record<string, string>) {
  return spawn(process.execPath, [SYNC_CLI], {
    env: { ...process.env, ...env, EPISODIC_MEMORY_SUMMARIZER_GUARD: undefined as any },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function collectOutput(child: ReturnType<typeof spawn>): Promise<RunResult> {
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', d => { stdout += d.toString(); });
  child.stderr!.on('data', d => { stderr += d.toString(); });
  const status: number | null = await new Promise(resolve => {
    child.on('close', code => resolve(code));
  });
  return { status, stdout, stderr };
}

describe('sync-cli single-instance lock (#97)', () => {
  let testDir: string;
  let envOverrides: Record<string, string>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-sync-lock-'));
    mkdirSync(join(testDir, 'projects', 'project-a'), { recursive: true });
    mkdirSync(join(testDir, 'archive'), { recursive: true });
    mkdirSync(join(testDir, 'config', 'logs'), { recursive: true });

    // A single zero-exchange file gives each worker something to (try to) do
    // without making the test slow or network-dependent.
    writeFileSync(
      join(testDir, 'projects', 'project-a', '00000000-0000-0000-0000-000000000001.jsonl'),
      JSON.stringify({
        type: 'file-history-snapshot',
        sessionId: '00000000-0000-0000-0000-000000000001',
        uuid: 'meta-0',
        timestamp: '2026-01-01T00:00:00Z',
      }),
      'utf-8'
    );

    envOverrides = {
      TEST_PROJECTS_DIR: join(testDir, 'projects'),
      TEST_ARCHIVE_DIR: join(testDir, 'archive'),
      TEST_DB_PATH: join(testDir, 'test.db'),
      EPISODIC_MEMORY_CONFIG_DIR: join(testDir, 'config'),
    };
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('only one of two concurrent workers does real work; the other prints "sync already running" and exits 0', async () => {
    // Launch two workers as close together as possible. One will win the lock
    // race; the other must observe it and bail before initDatabase().
    const a = spawnWith(envOverrides);
    const b = spawnWith(envOverrides);
    const [ra, rb] = await Promise.all([collectOutput(a), collectOutput(b)]);

    expect(ra.status).toBe(0);
    expect(rb.status).toBe(0);

    const winner = ra.stdout.includes('Sync complete') ? ra : rb;
    const loser = winner === ra ? rb : ra;

    expect(winner.stdout).toMatch(/Sync complete/);
    expect(loser.stderr).toMatch(/sync already running.*skipping/);
    expect(loser.stdout).not.toMatch(/Sync complete/);
  });

  it('routes eight public CLI starts through one worker and seven clean skips', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => collectOutput(spawnWith(envOverrides))));
    expect(results.every(result => result.status === 0)).toBe(true);
    expect(results.filter(result => /Sync complete/.test(result.stdout))).toHaveLength(1);
    expect(results.filter(result => /sync already running.*skipping/.test(result.stderr))).toHaveLength(7);
  }, 30_000);

  it('rejects direct --worker invocation before opening SQLite', () => {
    const result = spawnSync(process.execPath, [SYNC_CLI, '--worker'], {
      env: { ...process.env, ...envOverrides, EPISODIC_MEMORY_WRITER_TOKEN: 'forged' },
      timeout: 10_000,
      encoding: 'utf-8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/requires supervisor IPC/);
    expect(existsSync(envOverrides.TEST_DB_PATH)).toBe(false);
  });

  it('a single sequential run is unaffected by the lock — runs to completion as before', () => {
    const result = runWith(envOverrides);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Sync complete/);
  });

  it('releases the lock on normal exit — a subsequent run is not skipped', () => {
    const first = runWith(envOverrides);
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/Sync complete/);

    // Lock file must not be left behind for the next run.
    const lockPath = join(testDir, 'config', 'logs', 'episodic-memory-sync.lock');
    expect(existsSync(lockPath)).toBe(false);

    const second = runWith(envOverrides);
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/Sync complete/);
    expect(second.stderr).not.toMatch(/sync already running/);
  });

  it('steals a stale lock left by a crashed previous worker (PID 999999 is dead)', () => {
    const lockPath = join(testDir, 'config', 'logs', 'episodic-memory-sync.lock');
    writeFileSync(lockPath, '999999', 'utf-8');

    const result = runWith(envOverrides);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Sync complete/);
    expect(result.stderr).not.toMatch(/sync already running/);

    // After completion, the lock file is gone.
    expect(existsSync(lockPath)).toBe(false);
  });
});
