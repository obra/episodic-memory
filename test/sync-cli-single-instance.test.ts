import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, spawn } from 'child_process';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
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

// One exportable session is enough: the skipping worker must not report it.
function seedOpencodeDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      worktree TEXT NOT NULL,
      name TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      sandboxes TEXT NOT NULL
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      agent TEXT,
      model TEXT
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes)
    VALUES ('proj_1', '/work/example-project', 'Example Project', 1700000000000, 1700000000000, '[]')
  `).run();
  db.prepare(`
    INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, agent, model)
    VALUES ('ses_lock1', 'proj_1', 'lock-session', '/work/example-project', 'Lock Session', '1.17.8', 1700000000000, 1700000004000, 'build', ?)
  `).run(JSON.stringify({ id: 'claude-sonnet-4-5', providerID: 'anthropic', variant: 'default' }));
  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES ('msg_user', 'ses_lock1', 1700000001000, 1700000001000, ?)
  `).run(JSON.stringify({ role: 'user', time: { created: 1700000001000 }, agent: 'build' }));
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES ('prt_user_text', 'msg_user', 'ses_lock1', 1700000001000, 1700000001000, ?)
  `).run(JSON.stringify({ type: 'text', text: 'Hello from the opencode fixture.' }));
  db.close();
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
      EPISODIC_MEMORY_OPENCODE_DB_PATH: join(testDir, 'opencode.db'),
      EPISODIC_MEMORY_OPENCODE_TRANSCRIPT_DIR: join(testDir, 'opencode-transcripts'),
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

  it('a skipping worker never reads opencode.db (#212)', async () => {
    // The opencode export walks every session row in opencode.db, which on a
    // real machine reaches gigabytes of RSS. A worker that is about to skip
    // must bail before paying for it, so the lock has to be acquired first.
    seedOpencodeDb(envOverrides.EPISODIC_MEMORY_OPENCODE_DB_PATH);
    const lockPath = join(testDir, 'config', 'logs', 'episodic-memory-sync.lock');
    const handle = acquireFileLock(lockPath);
    expect(handle).not.toBeNull();
    try {
      const worker = await collectOutput(spawnWith(envOverrides));
      expect(worker.status).toBe(0);
      expect(worker.stderr).toMatch(/sync already running.*skipping/);
      expect(worker.stdout).not.toMatch(/opencode export/);
      expect(existsSync(envOverrides.EPISODIC_MEMORY_OPENCODE_TRANSCRIPT_DIR)).toBe(false);
    } finally {
      releaseFileLock(handle!);
    }
  });

  it('a lock holder still exports opencode sessions (#212 fix keeps the export)', () => {
    seedOpencodeDb(envOverrides.EPISODIC_MEMORY_OPENCODE_DB_PATH);
    const result = runWith(envOverrides);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/opencode export: 1 exported/);
    // The export must still precede source discovery, which picks up what it wrote.
    expect(readdirSync(envOverrides.EPISODIC_MEMORY_OPENCODE_TRANSCRIPT_DIR).length).toBeGreaterThan(0);
    expect(result.stdout).toMatch(/Sync complete/);
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
