/**
 * File-based exclusive locks. Thin wrapper around the `proper-lockfile`
 * package, which uses an atomic mkdir + mtime-heartbeat protocol that is
 * race-free under concurrent stale-stealers — the failure mode that pure
 * "openSync(wx) + PID file" implementations cannot fully close without
 * advisory locking (flock/fcntl).
 *
 * Used by long-running background work that must not run more than once at a
 * time on a given machine: the embedding migration (#73) and
 * `sync --background` (#97).
 *
 * On disk for a held lock at `<lockPath>`:
 *   <lockPath>             — diagnostic file containing the holder's PID
 *   <lockPath>.lock/       — proper-lockfile's mutex directory (mkdir-atomic)
 *
 * Stale recovery is mtime-based with a 10-minute threshold: if the holder
 * crashed without releasing, the .lock/ directory's mtime stops advancing,
 * and a contender past the threshold steals it atomically. The protocol's
 * atomicity guarantee is the package's contract — see proper-lockfile's
 * README for the underlying analysis (the same approach used by npm itself).
 *
 * Error policy:
 *   - `null` means lock contention.
 *   - Unexpected I/O errors (EACCES, ENOSPC, EMFILE, etc.) are thrown so
 *     callers can surface disk problems rather than mask them as "locked".
 */

import fs from 'fs';
import path from 'path';
import * as lockfile from 'proper-lockfile';

export interface FileLockHandle {
  path: string;
  release: () => void;
}

/**
 * Default stale threshold for the underlying proper-lockfile mtime heartbeat.
 * 10 minutes is well above the longest expected sync (a few minutes for a
 * cold start with hundreds of pending summaries) and the longest expected
 * embedding migration batch (seconds).
 */
const DEFAULT_STALE_MS = 10 * 60 * 1000;

export interface FileLockOptions {
  staleMs?: number;
  updateMs?: number;
  onCompromised?: (error: Error) => void;
}

export function acquireFileLock(lockPath: string, options: FileLockOptions = {}): FileLockHandle | null {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  // proper-lockfile expects the target path to exist. Touch it if missing —
  // 'a' (append, create if missing) leaves any existing PID intact.
  try {
    fs.closeSync(fs.openSync(lockPath, 'a'));
  } catch (err: any) {
    throw err;
  }

  let release: () => void;
  try {
    release = lockfile.lockSync(lockPath, {
      realpath: false,
      retries: 0,
      stale: options.staleMs ?? DEFAULT_STALE_MS,
      update: options.updateMs,
      onCompromised: options.onCompromised,
    });
  } catch (err: any) {
    if (err.code === 'ELOCKED') return null;
    throw err;
  }

  // Hold acquired. Record our PID for diagnostics ("which process holds the
  // lock right now?"). Best-effort — the mutex itself lives in .lock/.
  try {
    fs.writeFileSync(lockPath, String(process.pid), 'utf-8');
  } catch {}

  return { path: lockPath, release };
}

export function releaseFileLock(handle: FileLockHandle): void {
  try { handle.release(); } catch {}
  // Clean up the diagnostic file. A subsequent acquirer will recreate it.
  try { fs.unlinkSync(handle.path); } catch {}
}

/**
 * Read the recorded holder PID from a lock file's diagnostic content.
 * Returns null if the file doesn't exist or doesn't contain a valid PID.
 * The PID is informational only — the real mutex lives in `<lockPath>.lock/`.
 */
export function readLockHolder(lockPath: string): number | null {
  try {
    const pid = parseInt(fs.readFileSync(lockPath, 'utf-8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
