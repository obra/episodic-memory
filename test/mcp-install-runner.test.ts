import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  utimesSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from 'fs';
import { spawn as spawnProcess } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  acquireInstallLock,
  releaseInstallLock,
  runNpmInstall,
} from '../cli/install-runner.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRAPPER_PATH = join(REPO_ROOT, 'cli', 'mcp-server-wrapper.js');

function makeFakeChild(pid = 999999999): any {
  const child: any = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe('install-runner — install lock (#161)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'episodic-memory-install-lock-'));
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('a second acquire is excluded while the lock is held; re-acquiring works after release', () => {
    const first = acquireInstallLock(root);
    expect(first).not.toBeNull();

    const second = acquireInstallLock(root);
    expect(second).toBeNull();

    releaseInstallLock(first!);

    const third = acquireInstallLock(root);
    expect(third).not.toBeNull();
    releaseInstallLock(third!);
  });

  it('steals a stale lock past the threshold but leaves a fresh one alone', () => {
    const staleMs = 200;
    const lockPath = join(root, '.episodic-memory-install.lock');
    mkdirSync(lockPath);

    // Fresh lock (mtime = now): must NOT be stolen.
    expect(acquireInstallLock(root, { staleMs })).toBeNull();

    // Age the lock dir's mtime past the threshold: now it's stealable.
    const ancient = new Date(Date.now() - staleMs - 1000);
    utimesSync(lockPath, ancient, ancient);
    const stolen = acquireInstallLock(root, { staleMs });
    expect(stolen).not.toBeNull();
    releaseInstallLock(stolen!);
  });
});

describe('install-runner — runNpmInstall termination handling (#161)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'episodic-memory-install-runner-'));
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('terminate() kills the injected child and releases the lock, and leaves no listener leak after the child later reports exit', async () => {
    const beforeSigterm = process.listenerCount('SIGTERM');
    const beforeSigint = process.listenerCount('SIGINT');
    const beforeSighup = process.listenerCount('SIGHUP');
    const beforeExit = process.listenerCount('exit');

    const child = makeFakeChild();
    const fakeSpawn = vi.fn(() => child);
    const lock = acquireInstallLock(root);
    expect(lock).not.toBeNull();

    const install = runNpmInstall(root, { spawn: fakeSpawn, lockHandle: lock });

    // Handlers registered for the duration of the install.
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm + 1);

    // Invoke the termination/cleanup path directly — no real signal sent to
    // this test process.
    install.terminate();

    expect(child.kill).toHaveBeenCalled();
    expect(existsSync(join(root, '.episodic-memory-install.lock'))).toBe(false);

    // A moment later the (killed) child reports its actual exit. The exit
    // handler must not re-add or double-remove listeners.
    child.emit('exit', null);
    await install.promise.catch(() => {}); // terminate path may resolve or reject; only care about listener cleanup here

    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm);
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint);
    expect(process.listenerCount('SIGHUP')).toBe(beforeSighup);
    expect(process.listenerCount('exit')).toBe(beforeExit);
  });

  it('resolves and removes handlers when the child exits 0 normally (no termination)', async () => {
    const beforeSigterm = process.listenerCount('SIGTERM');

    const child = makeFakeChild();
    const fakeSpawn = vi.fn(() => child);
    const install = runNpmInstall(root, { spawn: fakeSpawn });

    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm + 1);

    child.emit('exit', 0);
    await expect(install.promise).resolves.toBeUndefined();

    expect(child.kill).not.toHaveBeenCalled();
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm);
  });

  it('rejects when the child exits non-zero, and still removes handlers', async () => {
    const beforeSigterm = process.listenerCount('SIGTERM');

    const child = makeFakeChild();
    const fakeSpawn = vi.fn(() => child);
    const install = runNpmInstall(root, { spawn: fakeSpawn });

    child.emit('exit', 1);
    await expect(install.promise).rejects.toThrow(/npm install failed/);

    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm);
  });
});

describe('mcp-server-wrapper — real spawn, orphan prevention on SIGTERM (#161)', () => {
  let root: string;
  let binDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'episodic-memory-wrapper-root-'));
    binDir = mkdtempSync(join(tmpdir(), 'episodic-memory-wrapper-bin-'));
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
    try { rmSync(binDir, { recursive: true, force: true }); } catch {}
  });

  it('kills the stub npm install child when the wrapper is SIGTERM-ed mid-install', async () => {
    // A stub "npm" that just stays alive and records its own pid, so we can
    // tell whether the wrapper's real child-tree kill reaches it. No network
    // call is made — this never touches the real npm registry.
    const pidFile = join(root, 'npm-stub.pid');
    const npmStubPath = join(binDir, 'npm');
    writeFileSync(
      npmStubPath,
      `#!/usr/bin/env node\n` +
        `import { writeFileSync } from 'fs';\n` +
        `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
        `setInterval(() => {}, 1000);\n`,
      'utf-8'
    );
    chmodSync(npmStubPath, 0o755);

    // An empty plugin root: node_modules is entirely absent, so the wrapper's
    // findMissingDeps probe reports everything missing and takes the install
    // path, invoking our stub "npm" (resolved via PATH, prepended below).
    const wrapper = spawnProcess(process.execPath, [WRAPPER_PATH], {
      cwd: root,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: root,
        PATH: `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      await waitFor(() => existsSync(pidFile), 10_000);
      const stubPid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      expect(Number.isFinite(stubPid)).toBe(true);
      expect(isAlive(stubPid)).toBe(true);

      wrapper.kill('SIGTERM');

      await waitFor(() => !isAlive(stubPid), 10_000);
      expect(isAlive(stubPid)).toBe(false);
    } finally {
      try { wrapper.kill('SIGKILL'); } catch {}
    }
  }, 20_000);
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!condition()) {
    throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
  }
}
