/**
 * Peek at the first ~8KB of a JSONL file and return whether the conversation
 * is a sidechain. A file is "sidechain" when the first record carrying an
 * isSidechain field has it set to true — subagent dispatches (every record),
 * Warmup stubs, prompt-suggestion sidechains, ai-title stubs, etc.
 *
 * Conservative: if we can't read the file, can't parse a record, or no record
 * carries the field within the scan cap, return false so the file is copied.
 * Mixed-content sessions (regular session with some sidechain records inline)
 * also return false — the indexer-side filter handles per-exchange skipping.
 */
export declare function isSidechainFile(filePath: string): boolean;
export interface SyncResult {
    copied: number;
    skipped: number;
    indexed: number;
    summarized: number;
    errors: Array<{
        file: string;
        error: string;
    }>;
}
export interface SyncOptions {
    skipIndex?: boolean;
    skipSummaries?: boolean;
    summaryLimit?: number;
}
export declare function extractSessionIdFromPath(filePath: string): string | null;
export declare function syncConversations(sourceDir: string, destDir: string, options?: SyncOptions): Promise<SyncResult>;
