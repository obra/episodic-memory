/**
 * `npm install` orchestration for mcp-server-wrapper.js: a single-flight lock
 * plus a tracked, killable child so a wrapper killed mid-install (e.g. the
 * MCP client's 30s connect timeout) doesn't leave the install running as an
 * orphan, and so a second wrapper launched while one is already installing
 * doesn't start a competing install (#161).
 *
 * Deliberately built on Node built-ins only (`fs`, `child_process`) — this
 * lock guards the very first-run `npm install` that provides the rest of
 * this plugin's dependencies (including `proper-lockfile`, which backs the
 * locking used elsewhere in this repo). Using a node_modules package here
 * would be reaching for a dependency that, at the moment this code needs to
 * run, may not be installed yet.
 *
 * Lock protocol: an atomic `fs.mkdirSync(lockDir)` — EEXIST means another
 * process holds it. Staleness is mtime-based: a lock dir older than
 * `staleMs` is assumed to belong to a dead orphan (a wrapper that was killed
 * without reaching its cleanup) and is stolen.
 */

import { spawn as defaultSpawn } from 'child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

const LOCK_DIR_NAME = '.episodic-memory-install.lock';

/** An install that outlives this is almost certainly a dead orphan, not a slow install. */
const DEFAULT_STALE_MS = 5 * 60 * 1000;

function lockPathFor(pluginRoot) {
  return join(pluginRoot, LOCK_DIR_NAME);
}

/**
 * Acquire the install lock under `pluginRoot`. Returns a handle on success,
 * or `null` when another live install holds it. Steals a lock whose mtime is
 * older than `staleMs` (default 5 minutes) rather than waiting on it forever.
 */
export function acquireInstallLock(pluginRoot, { staleMs = DEFAULT_STALE_MS } = {}) {
  const lockPath = lockPathFor(pluginRoot);

  try {
    mkdirSync(lockPath);
    return { path: lockPath };
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  // Held. Check whether it's stale enough to steal.
  let mtimeMs;
  try {
    mtimeMs = statSync(lockPath).mtimeMs;
  } catch {
    // Disappeared between our failed mkdir and this stat (the holder just
    // released it) — one retry is enough; a persistent race is vanishingly
    // unlikely for a lock this short-lived.
    try {
      mkdirSync(lockPath);
      return { path: lockPath };
    } catch (err) {
      if (err.code === 'EEXIST') return null;
      throw err;
    }
  }

  if (Date.now() - mtimeMs <= staleMs) {
    return null; // held and fresh
  }

  // Stale: steal it. Best-effort — if another process wins the race and
  // recreates the dir first, our mkdir below fails EEXIST and we back off.
  try {
    rmSync(lockPath, { recursive: true, force: true });
  } catch {}
  try {
    mkdirSync(lockPath);
    return { path: lockPath };
  } catch (err) {
    if (err.code === 'EEXIST') return null;
    throw err;
  }
}

/** Release a lock handle. Idempotent and best-effort. */
export function releaseInstallLock(handle) {
  if (!handle) return;
  try {
    rmSync(handle.path, { recursive: true, force: true });
  } catch {}
}

/**
 * Poll until the install lock under `pluginRoot` is free, or `timeoutMs`
 * elapses. Returns `true` if the lock was free by the time this returned,
 * `false` if the wait cap was hit (caller proceeds best-effort either way).
 */
export async function waitForInstallLock(pluginRoot, { pollMs = 250, timeoutMs = 60_000 } = {}) {
  const lockPath = lockPathFor(pluginRoot);
  const deadline = Date.now() + timeoutMs;
  while (existsSync(lockPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return !existsSync(lockPath);
}

/**
 * Run `npm install` in `pluginRoot`, tracked so it can be killed if this
 * process is terminated mid-install.
 *
 * On POSIX, the child is spawned `detached: true` (its own process group) so
 * termination can kill the whole tree — npm's own grandchildren (node-gyp
 * rebuilds, etc.) — via `process.kill(-pid, signal)`, not just the direct
 * child. Windows can't kill by negative pid, so it falls back to `child.kill()`
 * there (and only there).
 *
 * Registers `process.on('exit'|'SIGTERM'|'SIGINT'|'SIGHUP', ...)` handlers
 * for the duration of the install and removes them once the child exits, so
 * a signal arriving during install (previously unhandled — the wrapper's
 * signal forwarding was wired up only after the server started) now kills
 * the install instead of orphaning it. If `lockHandle` is given, it's
 * released on every exit path (child exit, termination, spawn error).
 *
 * Returns `{ promise, terminate }`: `promise` resolves on a clean install and
 * rejects otherwise (mirroring the child's exit code); `terminate()` runs the
 * same kill+release+cleanup path a termination signal would, exposed so
 * tests can exercise it directly without sending a real signal to the test
 * process.
 */
export function runNpmInstall(pluginRoot, { spawn = defaultSpawn, lockHandle } = {}) {
  const isWindows = process.platform === 'win32';
  const npmCommand = isWindows ? 'npm.cmd' : 'npm';

  console.error('Installing episodic-memory dependencies (first run only)...');
  console.error('This may take 30-60 seconds...');

  const child = spawn(npmCommand, ['install', '--no-audit', '--no-fund'], {
    cwd: pluginRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows, // On Windows, we need shell: true to find npm.cmd
    detached: !isWindows,
  });

  child.stdout?.on('data', (data) => {
    // Suppress npm install output to stderr to avoid cluttering MCP logs.
    process.stderr.write(data);
  });
  child.stderr?.on('data', (data) => {
    process.stderr.write(data);
  });

  function killChild(signal) {
    if (!isWindows && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // Group kill failed (already dead, not a group leader, etc.) — fall
        // through to killing just the direct child.
      }
    }
    try {
      child.kill(signal);
    } catch {}
  }

  let handlersRemoved = false;
  function removeHandlers() {
    if (handlersRemoved) return;
    handlersRemoved = true;
    process.removeListener('exit', onProcessExit);
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGHUP', onSighup);
  }

  let cleanedUp = false;
  function terminate(signal = 'SIGTERM') {
    if (cleanedUp) return;
    cleanedUp = true;
    killChild(signal);
    releaseInstallLock(lockHandle);
    removeHandlers();
  }

  // 'exit' listeners must be synchronous — this is a last-resort safety net
  // in case the process is exiting some other way with the install child
  // still alive; the signal handlers below cover the normal termination path.
  function onProcessExit() {
    terminate();
  }
  function onSigterm() {
    terminate('SIGTERM');
  }
  function onSigint() {
    terminate('SIGINT');
  }
  function onSighup() {
    terminate('SIGHUP');
  }

  process.on('exit', onProcessExit);
  process.on('SIGTERM', onSigterm);
  process.on('SIGINT', onSigint);
  process.on('SIGHUP', onSighup);

  const promise = new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      removeHandlers();
      releaseInstallLock(lockHandle);
      if (code === 0) {
        console.error('Dependencies installed successfully.');
        resolve();
      } else {
        console.error('ERROR: Failed to install dependencies.');
        console.error(`Please run manually: cd "${pluginRoot}" && npm install`);
        reject(new Error(`npm install failed with exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      removeHandlers();
      releaseInstallLock(lockHandle);
      console.error(`ERROR: Failed to run npm install: ${err.message}`);
      reject(err);
    });
  });

  return { promise, terminate };
}
