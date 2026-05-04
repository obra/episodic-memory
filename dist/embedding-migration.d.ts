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
import Database from 'better-sqlite3';
/** Bump when anything in the embedding pipeline changes (model, dtype, prefix). */
export declare const EMBEDDING_VERSION = 1;
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
export declare function acquireMigrationLock(lockPath: string): MigrationLockHandle | null;
export declare function releaseMigrationLock(handle: MigrationLockHandle): void;
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
export declare function pickStaleBatch(db: Database.Database, limit: number): StaleRow[];
/**
 * Replace a row's vec_exchanges embedding and stamp its embedding_version
 * atomically. Wrap each batch's calls in a single transaction at the caller
 * for durability; this function executes its statements in order without
 * starting its own transaction.
 */
export declare function recordReembedded(db: Database.Database, id: string, embedding: number[]): void;
/**
 * Count rows whose embedding is older than the current version.
 * Used to decide whether migration is needed and to report progress.
 */
export declare function countStale(db: Database.Database): number;
/** Path of the migration lock under the index directory. */
export declare function getMigrationLockPath(indexDir: string): string;
/**
 * Run a single migration batch: re-embed up to `batchSize` rows whose
 * embedding_version is behind. Lock-protected; exits silently if another
 * process holds the lock.
 *
 * Returns the number of rows re-embedded (0 if nothing to do or locked out).
 */
export declare function runMigrationBatch(db: Database.Database, indexDir: string, batchSize: number, embedFn: (user: string, assistant: string, toolNames?: string[]) => Promise<number[]>): Promise<number>;
