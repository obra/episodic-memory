import fs from 'fs';
import { getLockFilePath } from './paths.js';

let activeLockPath: string | null = null;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // EPERM means the process exists but we lack permission to signal it
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EPERM') {
      return true;
    }
    return false;
  }
}

export function acquireSyncLock(): boolean {
  const lockPath = getLockFilePath();

  if (fs.existsSync(lockPath)) {
    try {
      const existingPid = parseInt(fs.readFileSync(lockPath, 'utf-8').trim(), 10);
      if (!isNaN(existingPid) && existingPid !== process.pid && isProcessAlive(existingPid)) {
        console.error(`Sync already running (PID ${existingPid}), skipping.`);
        return false;
      }
      // Stale lock — remove it
      fs.unlinkSync(lockPath);
    } catch {
      // Lock file unreadable — remove it
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    }
  }

  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    activeLockPath = lockPath;
    return true;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Race condition: another process created it between our check and write
      console.error('Sync lock acquired by another process, skipping.');
      return false;
    }
    throw err;
  }
}

export function releaseSyncLock(): void {
  if (activeLockPath) {
    try {
      fs.unlinkSync(activeLockPath);
    } catch {
      // Already removed — fine
    }
    activeLockPath = null;
  }
}
