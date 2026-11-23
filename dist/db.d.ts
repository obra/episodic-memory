import Database from 'better-sqlite3';
import { ConversationExchange } from './types.js';
export declare function migrateSchema(db: Database.Database): void;
/**
 * One-time correction of Codex rows indexed before the parser took a
 * rollout's identity from its first session_meta: mark subagent rows as
 * sidechains, and refresh the metadata a fresh parse assigns wherever rows
 * were stored under another session (forks embed their parent's
 * session_meta, whose session, cwd, project, version and provider used to
 * win). Sync skips unchanged transcripts, so
 * only this pass corrects existing rows. Rows whose exchange ID a fresh parse
 * no longer produces still get the rollout's sidechain flag and session ID.
 *
 * Each rollout commits on its own. Deleted archives are skipped; other
 * unreadable archives are returned in `failed` and the pass is recorded as complete only when there are none, so
 * they are retried on the next call. Once complete, later calls return
 * immediately instead of re-reading every main-thread rollout.
 */
export declare function backfillCodexSidechains(db: Database.Database): Promise<{
    updated: number;
    failed: string[];
}>;
/**
 * Earlier versions created `tool_calls` with a plain
 * `FOREIGN KEY (exchange_id) REFERENCES exchanges(id)`.
 * Without ON DELETE CASCADE, deleting an exchange that had tool calls
 * raised SQLITE_CONSTRAINT_FOREIGNKEY (#81), and orphans accumulated.
 *
 * This migration:
 *   1. Detects the legacy schema by inspecting sqlite_master.sql.
 *   2. Drops orphaned tool_calls rows.
 *   3. Recreates the table with ON DELETE CASCADE and copies surviving rows.
 */
export declare function migrateToolCallsCascade(db: Database.Database): void;
export declare function initDatabase(): Database.Database;
export declare function insertExchange(db: Database.Database, exchange: ConversationExchange, embedding: number[], toolNames?: string[]): void;
export declare function getAllExchanges(db: Database.Database): Array<{
    id: string;
    archivePath: string;
}>;
export declare function getFileLastIndexed(db: Database.Database, archivePath: string): number | null;
export declare function deleteExchange(db: Database.Database, id: string): void;
