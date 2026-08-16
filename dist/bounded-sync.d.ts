import type { ConversationExchange } from './types.js';
import { SummaryState } from './archive-ledger.js';
import { RcloneTransport, RunBudget } from './rclone-transport.js';
interface PreparedExchange {
    exchange: ConversationExchange;
    embedding: number[];
    toolNames?: string[];
}
interface PreparedConversation {
    exchanges: PreparedExchange[];
    summaryText: string | null;
    summaryState: SummaryState;
}
export interface BoundedSyncOptions {
    sourceDirs: string[];
    cacheDir: string;
    remoteBase: string;
    dbPath?: string;
    transport?: Pick<RcloneTransport, 'uploadVerified'>;
    budget?: RunBudget;
    freeBytes?: (cacheDir: string) => number;
    prepare?: (localPath: string, project: string, remoteKey: string, objectId: string) => Promise<PreparedConversation>;
}
export interface BoundedSyncResult {
    uploaded: number;
    indexed: number;
    skipped: number;
    boundedStop?: string;
    errors: Array<{
        file: string;
        error: string;
    }>;
}
export declare function syncBoundedSourceDirs(options: BoundedSyncOptions): Promise<BoundedSyncResult>;
export {};
