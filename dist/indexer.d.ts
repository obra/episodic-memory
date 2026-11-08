import { ConversationExchange } from './types.js';
/**
 * Session ID to resume when summarizing. A subagent transcript
 * (`<parent>/subagents/agent-<hex>.jsonl`) stamps every line with the PARENT
 * session's ID and `isSidechain: true`; resuming that ID summarizes the
 * parent, not the subagent. Return undefined so the summarizer reads the
 * transcript text instead, matching sync's extractSessionIdFromPath(), which
 * finds no session ID in an `agent-<hex>` filename.
 */
export declare function sessionIdForSummary(exchanges: ConversationExchange[]): string | undefined;
export declare function indexConversations(limitToProject?: string, maxConversations?: number, concurrency?: number, noSummaries?: boolean): Promise<void>;
export declare function indexSession(sessionId: string, concurrency?: number, noSummaries?: boolean): Promise<void>;
export declare function indexUnprocessed(concurrency?: number, noSummaries?: boolean): Promise<void>;
