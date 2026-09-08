import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { acquireFileLock, releaseFileLock } from '../src/file-lock.js';

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

  it('a worker skips ("sync already running") and exits 0 when the lock is already held', async () => {
    // Deterministic contention: hold the real proper-lockfile mutex from the
    // test process, then a spawned worker must observe it and bail before
    // initDatabase(). (An earlier version raced two spawned workers and relied
    // on their execution windows overlapping; under a loaded parallel test run
    // the OS could schedule them far enough apart that the first released the
    // lock before the second acquired, so both did real work — a false failure.)
    const lockPath = join(testDir, 'config', 'logs', 'episodic-memory-sync.lock');
    const handle = acquireFileLock(lockPath);
    expect(handle).not.toBeNull();
    try {
      const worker = await collectOutput(spawnWith(envOverrides));
      expect(worker.status).toBe(0);
      expect(worker.stderr).toMatch(/sync already running.*skipping/);
      expect(worker.stdout).not.toMatch(/Sync complete/);
    } finally {
      releaseFileLock(handle!);
    }
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
