import { initDatabase } from './db.js';
import { ConversationExchange } from './types.js';
/**
 * Embed and insert exchanges, skipping sidechains (subagent dispatches, Warmup
 * stubs, prompt-suggestion sidechains). Search excludes them via
 * `AND is_sidechain = 0`, so indexing them would embed and store rows no query
 * can ever return. Returns the number of exchanges actually inserted.
 *
 * This is the single place that decides what gets indexed — every indexing
 * path (full reindex, single session, unprocessed backlog, background sync,
 * verify/repair) routes through here so the sidechain filter can't be missed.
 */
export declare function indexExchanges(db: ReturnType<typeof initDatabase>, exchanges: ConversationExchange[]): Promise<number>;
export declare function indexConversations(limitToProject?: string, maxConversations?: number, concurrency?: number, noSummaries?: boolean): Promise<void>;
export declare function indexSession(sessionId: string, concurrency?: number, noSummaries?: boolean): Promise<void>;
export declare function indexUnprocessed(concurrency?: number, noSummaries?: boolean): Promise<void>;
