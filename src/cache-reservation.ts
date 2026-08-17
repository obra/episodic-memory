import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { setTimeout as delay } from 'timers/promises';
import { acquireFileLock, releaseFileLock } from './file-lock.js';
import { checkCacheCapacity, type CapacityResult } from './rclone-transport.js';

const RESERVATION_DIR = '.episodic-cache-reservations';
const REGISTRY_LOCK_WAIT_MS = 5_000;

interface ReservationRecord {
  token: string;
  pid: number;
  bytes: number;
  localPath: string;
}

export interface CacheReservation extends CapacityResult {
  release: () => void;
}

export async function reserveCacheCapacity(
  cacheDir: string,
  localPath: string,
  nextBytes: number,
  freeBytes: () => number = () => {
    const stat = fs.statfsSync(cacheDir);
    return Number(stat.bavail) * Number(stat.bsize);
  },
): Promise<CacheReservation> {
  fs.mkdirSync(cacheDir, { recursive: true });
  const resolvedCache = path.resolve(cacheDir);
  const resolvedLocal = path.resolve(localPath);
  const relativeLocal = path.relative(resolvedCache, resolvedLocal);
  if (relativeLocal.startsWith('..') || path.isAbsolute(relativeLocal)) {
    throw new Error('cache reservation path must stay inside the cache directory');
  }

  const reservationDir = path.join(resolvedCache, RESERVATION_DIR);
  fs.mkdirSync(reservationDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(reservationDir, 'registry');
  const deadline = Date.now() + REGISTRY_LOCK_WAIT_MS;
  let handle = acquireFileLock(lockPath, { staleMs: REGISTRY_LOCK_WAIT_MS, updateMs: 1_000 });
  while (!handle && Date.now() < deadline) {
    await delay(10);
    handle = acquireFileLock(lockPath, { staleMs: REGISTRY_LOCK_WAIT_MS, updateMs: 1_000 });
  }
  if (!handle) throw new Error('timed out waiting for cache reservation registry');

  try {
    const active = readActiveReservations(reservationDir, resolvedCache);
    const unmaterializedBytes = active.reduce((total, record) => {
      const materialized = fileSize(record.localPath);
      return total + Math.max(0, record.bytes - materialized);
    }, 0);
    const capacity = checkCacheCapacity(
      cacheSize(resolvedCache) + unmaterializedBytes,
      nextBytes,
      freeBytes() - unmaterializedBytes,
    );
    if (!capacity.allowed) return { ...capacity, release: () => {} };

    const token = `${process.pid}.${randomUUID()}`;
    const reservationPath = path.join(reservationDir, `${token}.json`);
    const record: ReservationRecord = { token, pid: process.pid, bytes: nextBytes, localPath: resolvedLocal };
    fs.writeFileSync(reservationPath, JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return {
      allowed: true,
      release: () => {
        try { fs.unlinkSync(reservationPath); } catch {}
        try { fs.rmdirSync(reservationDir); } catch {}
      },
    };
  } finally {
    releaseFileLock(handle);
    try { fs.rmdirSync(reservationDir); } catch {}
  }
}

function readActiveReservations(reservationDir: string, cacheDir: string): ReservationRecord[] {
  const active: ReservationRecord[] = [];
  for (const name of fs.readdirSync(reservationDir)) {
    if (!name.endsWith('.json')) continue;
    const recordPath = path.join(reservationDir, name);
    try {
      const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as ReservationRecord;
      const relative = path.relative(cacheDir, path.resolve(record.localPath));
      if (!Number.isInteger(record.pid) || record.pid <= 0 || record.bytes < 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('invalid cache reservation');
      }
      if (!processIsAlive(record.pid)) {
        fs.unlinkSync(recordPath);
        continue;
      }
      active.push(record);
    } catch {
      try { fs.unlinkSync(recordPath); } catch {}
    }
  }
  return active;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

function fileSize(filePath: string): number {
  try { return fs.statSync(filePath).size; } catch { return 0; }
}

function cacheSize(dir: string): number {
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === RESERVATION_DIR) continue;
    const item = path.join(dir, entry.name);
    bytes += entry.isDirectory() ? cacheSize(item) : fs.statSync(item).size;
  }
  return bytes;
}
