import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('sync lock file', () => {
  let testDir: string;
  let lockPath: string;

  beforeEach(() => {
    vi.resetModules();
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-lock-test-'));
    lockPath = join(testDir, 'sync.lock');
    process.env.EPISODIC_MEMORY_CONFIG_DIR = testDir;
  });

  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should acquire lock when no lock exists', async () => {
    const { acquireSyncLock, releaseSyncLock } = await import('../src/sync-lock.js');
    const acquired = acquireSyncLock();
    expect(acquired).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
    const content = readFileSync(lockPath, 'utf-8');
    expect(content).toBe(String(process.pid));
    releaseSyncLock();
  });

  it('should fail to acquire lock when another live process holds it', async () => {
    const { acquireSyncLock } = await import('../src/sync-lock.js');
    // PID 1 is always alive (init/launchd)
    writeFileSync(lockPath, '1');
    const acquired = acquireSyncLock();
    expect(acquired).toBe(false);
  });

  it('should acquire lock when lock file has stale PID', async () => {
    const { acquireSyncLock, releaseSyncLock } = await import('../src/sync-lock.js');
    // PID 99999999 should not be alive
    writeFileSync(lockPath, '99999999');
    const acquired = acquireSyncLock();
    expect(acquired).toBe(true);
    releaseSyncLock();
  });

  it('should release lock by removing file', async () => {
    const { acquireSyncLock, releaseSyncLock } = await import('../src/sync-lock.js');
    acquireSyncLock();
    expect(existsSync(lockPath)).toBe(true);
    releaseSyncLock();
    expect(existsSync(lockPath)).toBe(false);
  });
});
