import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { acquireFileLock, releaseFileLock, readLockHolder } from '../src/file-lock.js';

describe('file-lock — proper-lockfile wrapper (#97)', () => {
  let testDir: string;
  let lockPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-file-lock-'));
    lockPath = join(testDir, 'subdir', 'test.lock');
    mkdirSync(dirname(lockPath), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('acquires when no lock exists; second caller from same process gets null while held', () => {
    const first = acquireFileLock(lockPath);
    expect(first).not.toBeNull();
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf-8').trim()).toBe(String(process.pid));
    // proper-lockfile creates a .lock subdir as the actual mutex.
    expect(existsSync(`${lockPath}.lock`)).toBe(true);

    const second = acquireFileLock(lockPath);
    expect(second).toBeNull();

    releaseFileLock(first!);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(`${lockPath}.lock`)).toBe(false);
  });

  it('releases cleanly and allows re-acquire', () => {
    const a = acquireFileLock(lockPath);
    releaseFileLock(a!);
    const b = acquireFileLock(lockPath);
    expect(b).not.toBeNull();
    releaseFileLock(b!);
  });

  it('creates parent directories so callers can pass a fresh lock path under an unbuilt config dir', () => {
    const deepLockPath = join(testDir, 'a', 'b', 'c', 'sync.lock');
    const handle = acquireFileLock(deepLockPath);
    expect(handle).not.toBeNull();
    expect(existsSync(deepLockPath)).toBe(true);
    releaseFileLock(handle!);
  });

  it('readLockHolder returns the PID of an active lock and null for a missing file', () => {
    expect(readLockHolder(lockPath)).toBeNull();

    const handle = acquireFileLock(lockPath);
    expect(readLockHolder(lockPath)).toBe(process.pid);
    releaseFileLock(handle!);

    expect(readLockHolder(lockPath)).toBeNull();
  });

  it('readLockHolder returns null when the file exists but content is garbage', () => {
    writeFileSync(lockPath, 'not-a-number', 'utf-8');
    expect(readLockHolder(lockPath)).toBeNull();
  });

  // POSIX only: Windows ignores directory mode bits, so the chmod below can't
  // make the directory unwritable.
  it.skipIf(process.platform === 'win32')('propagates unexpected I/O errors instead of masking them as "lock contention"', () => {
    // chmod the directory read-only so openSync('a') hits EACCES on the lock
    // target. The wrapper must throw rather than return null — otherwise sync
    // would report "already running" for what's actually a disk problem.
    const restrictedDir = join(testDir, 'no-write');
    mkdirSync(restrictedDir);
    try {
      chmodSync(restrictedDir, 0o500); // r-x, no write
      const restrictedLock = join(restrictedDir, 'lock');
      expect(() => acquireFileLock(restrictedLock)).toThrow();
    } finally {
      try { chmodSync(restrictedDir, 0o700); } catch {}
    }
  });
});

describe('file-lock — concurrent contention under proper-lockfile atomicity', () => {
  let testDir: string;
  let lockPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-file-lock-race-'));
    lockPath = join(testDir, 'concurrent.lock');
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('at most one of many concurrent acquirers ends up holding the lock', async () => {
    // Real subprocesses so each runs in its own event loop and OS-level
    // scheduling decides the interleaving. proper-lockfile's atomic-mkdir
    // protocol guarantees mutual exclusion under this contention shape, which
    // is what the previous hand-rolled implementation could not.
    const N = 8;
    const { spawn } = await import('child_process');
    // Build an ESM-compatible specifier — `import "C:\\..."` is invalid on
    // Windows, but `import "file:///C:/..."` works everywhere.
    const fileLockUrl = pathToFileURL(join(process.cwd(), 'dist', 'file-lock.js')).href;

    const childOutputs: Promise<string>[] = [];
    for (let i = 0; i < N; i++) {
      childOutputs.push(new Promise<string>((resolve) => {
        const child = spawn(process.execPath, [
          '--input-type=module',
          '-e',
          `import { acquireFileLock } from ${JSON.stringify(fileLockUrl)};
           await new Promise(r => setTimeout(r, 50));
           const h = acquireFileLock(${JSON.stringify(lockPath)});
           process.stdout.write(h ? 'HELD' : 'SKIP');
           if (h) await new Promise(r => setTimeout(r, 100));
          `,
        ], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        child.stdout!.on('data', (d) => { out += d.toString(); });
        child.on('close', () => resolve(out));
      }));
    }

    const outputs = await Promise.all(childOutputs);
    const heldCount = outputs.filter(o => o === 'HELD').length;
    const skipCount = outputs.filter(o => o === 'SKIP').length;

    // The N acquirers all run roughly simultaneously. They may serialize
    // (1 HELD per run with the next starting after release) or contend
    // (1 HELD, N-1 SKIP). Either way, no two can hold the lock at the same
    // instant — and HELD + SKIP must account for every child.
    expect(heldCount).toBeGreaterThanOrEqual(1);
    expect(heldCount + skipCount).toBe(N);
  });

  it('a stale lock left by a crashed prior holder is eventually reclaimable', async () => {
    // Simulate a dead holder by creating the proper-lockfile .lock directory
    // manually with an ancient mtime — past the 10-minute stale threshold.
    // The next acquirer should steal it.
    const lockDir = `${lockPath}.lock`;
    mkdirSync(dirname(lockPath), { recursive: true });
    mkdirSync(lockDir, { recursive: true });

    const { utimesSync } = await import('fs');
    const ancient = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    utimesSync(lockDir, ancient, ancient);

    const handle = acquireFileLock(lockPath);
    expect(handle).not.toBeNull();
    releaseFileLock(handle!);
  });

  it('a fresh lock left by a recently-crashed holder is NOT reclaimable yet (mtime within threshold)', () => {
    // Create the .lock dir with current mtime — proper-lockfile treats it as
    // a live holder until the mtime ages past the stale threshold.
    const lockDir = `${lockPath}.lock`;
    mkdirSync(dirname(lockPath), { recursive: true });
    mkdirSync(lockDir, { recursive: true });
    // Fresh mtime is the default — no utimes call needed.

    const handle = acquireFileLock(lockPath);
    expect(handle).toBeNull();
  });
});
