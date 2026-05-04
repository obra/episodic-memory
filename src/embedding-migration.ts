/**
 * Embedding migration.
 *
 * The encoder was upgraded from all-MiniLM-L6-v2 to bge-small-en-v1.5. Existing
 * databases have vec_exchanges rows produced by the old encoder. This module
 * provides the primitives for an incremental, lock-protected, resumable
 * background migration that re-embeds stale rows in batches during sync.
 *
 *   EMBEDDING_VERSION   — bumped any time the encoder pipeline changes
 *   acquire/release lock — file-based with PID-liveness fallback
 *   pickStaleBatch       — find rows whose embedding_version is behind
 *   recordReembedded     — atomic update of vec_exchanges + version bump
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

/** Bump when anything in the embedding pipeline changes (model, dtype, prefix). */
export const EMBEDDING_VERSION = 1;

export interface MigrationLockHandle {
  path: string;
  fd: number;
}

/**
 * Acquire an exclusive migration lock by writing our PID to the lock file.
 * Returns null if another live process holds the lock.
 *
 * Stale-lock recovery: if the lock file's PID is no longer alive, we steal it.
 * This avoids needing manual cleanup after crashes or kills.
 */
export function acquireMigrationLock(lockPath: string): MigrationLockHandle | null {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  // Try exclusive create first.
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, String(process.pid));
    return { path: lockPath, fd };
  } catch (err: any) {
    if (err.code !== 'EEXIST') throw err;
  }

  // Lock exists. Check whether the holder is still alive.
  let holderPid: number;
  try {
    holderPid = parseInt(fs.readFileSync(lockPath, 'utf-8').trim(), 10);
  } catch {
    holderPid = NaN;
  }

  if (Number.isFinite(holderPid) && holderPid > 0 && isProcessAlive(holderPid)) {
    // The holder is alive (possibly us — concurrent acquires from the same
    // process must serialize via release/acquire pairs).
    return null;
  }

  // Stale lock. Replace it.
  try {
    fs.unlinkSync(lockPath);
  } catch {}
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, String(process.pid));
    return { path: lockPath, fd };
  } catch {
    return null;
  }
}

export function releaseMigrationLock(handle: MigrationLockHandle): void {
  try { fs.closeSync(handle.fd); } catch {}
  try { fs.unlinkSync(handle.path); } catch {}
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}

export interface StaleRow {
  id: string;
  user_message: string;
  assistant_message: string;
  tools: string | null;
}

/**
 * Return up to `limit` rows whose embedding_version is older than
 * EMBEDDING_VERSION, joined with their tool names so the caller can
 * reproduce the production exchange-text format.
 */
export function pickStaleBatch(db: Database.Database, limit: number): StaleRow[] {
  return db.prepare(`
    SELECT
      e.id,
      e.user_message,
      e.assistant_message,
      GROUP_CONCAT(DISTINCT tc.tool_name) AS tools
    FROM exchanges e
    LEFT JOIN tool_calls tc ON tc.exchange_id = e.id
    WHERE e.embedding_version < ?
    GROUP BY e.id
    LIMIT ?
  `).all(EMBEDDING_VERSION, limit) as StaleRow[];
}

/**
 * Replace a row's vec_exchanges embedding and stamp its embedding_version
 * atomically. Wrap each batch's calls in a single transaction at the caller
 * for durability; this function executes its statements in order without
 * starting its own transaction.
 */
export function recordReembedded(
  db: Database.Database,
  id: string,
  embedding: number[],
): void {
  db.prepare('DELETE FROM vec_exchanges WHERE id = ?').run(id);
  db.prepare('INSERT INTO vec_exchanges (id, embedding) VALUES (?, ?)')
    .run(id, Buffer.from(new Float32Array(embedding).buffer));
  db.prepare('UPDATE exchanges SET embedding_version = ? WHERE id = ?')
    .run(EMBEDDING_VERSION, id);
}

/**
 * Count rows whose embedding is older than the current version.
 * Used to decide whether migration is needed and to report progress.
 */
export function countStale(db: Database.Database): number {
  const row = db.prepare(
    'SELECT COUNT(*) AS c FROM exchanges WHERE embedding_version < ?'
  ).get(EMBEDDING_VERSION) as { c: number };
  return row.c;
}

/** Path of the migration lock under the index directory. */
export function getMigrationLockPath(indexDir: string): string {
  return path.join(indexDir, '.embedding-migration.lock');
}

/**
 * Run a single migration batch: re-embed up to `batchSize` rows whose
 * embedding_version is behind. Lock-protected; exits silently if another
 * process holds the lock.
 *
 * Returns the number of rows re-embedded (0 if nothing to do or locked out).
 */
export async function runMigrationBatch(
  db: Database.Database,
  indexDir: string,
  batchSize: number,
  embedFn: (user: string, assistant: string, toolNames?: string[]) => Promise<number[]>,
): Promise<number> {
  const remaining = countStale(db);
  if (remaining === 0) return 0;

  const lockPath = getMigrationLockPath(indexDir);
  const lock = acquireMigrationLock(lockPath);
  if (!lock) {
    console.error(`episodic-memory: another process is migrating embeddings (${remaining} rows still stale); skipping`);
    return 0;
  }

  try {
    const rows = pickStaleBatch(db, batchSize);
    if (rows.length === 0) return 0;

    console.error(`episodic-memory: re-embedding batch of ${rows.length} (${remaining} stale total)...`);

    // Compute embeddings outside the transaction (async work),
    // then write atomically (one transaction per batch for durability).
    const embeddings: Array<{ id: string; vec: number[] }> = [];
    for (const row of rows) {
      const tools = row.tools ? row.tools.split(',') : undefined;
      const vec = await embedFn(row.user_message, row.assistant_message, tools);
      embeddings.push({ id: row.id, vec });
    }
    const writeTx = db.transaction((items: typeof embeddings) => {
      for (const item of items) recordReembedded(db, item.id, item.vec);
    });
    writeTx(embeddings);
    return embeddings.length;
  } finally {
    releaseMigrationLock(lock);
  }
}
