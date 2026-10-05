import { FindingsTally, type RedactionFinding, type Redactor } from './redaction.js';
/**
 * Stream and scan for any exclusion marker, carrying an overlap between
 * chunks so a marker split across a boundary is still found. A single
 * fs.readFileSync(path, 'utf-8') throws ERR_STRING_TOO_LONG above Node's
 * ~512 MB max string length; the old catch returned false (fail OPEN),
 * silently indexing a file whose DO NOT INDEX marker we never read (#152).
 * Streaming confirms cleanliness at any size, and a real read error now
 * fails CLOSED (skip) rather than open.
 */
export declare function shouldSkipConversation(filePath: string): boolean;
export interface SyncResult {
    copied: number;
    skipped: number;
    indexed: number;
    summarized: number;
    errors: Array<{
        file: string;
        error: string;
    }>;
    /** Rule IDs and counts only — never matched values. */
    redactions: RedactionFinding[];
}
export interface SyncOptions {
    skipIndex?: boolean;
    skipSummaries?: boolean;
    summaryLimit?: number;
    /**
     * Redactor applied at the archive write. `undefined` loads it from the
     * environment (loadRedactor); `null` means redaction is off.
     */
    redactor?: Redactor | null;
}
/**
 * Derive sync options from the process environment.
 *
 * `EPISODIC_MEMORY_SKIP_SUMMARIES=1` turns the summarization pass off.
 * Only the exact string '1' enables the switch — unset, '0', 'true',
 * and anything else leave summarization on, so a stray value can't
 * silently disable a feature the user still expects.
 *
 * Why anyone wants this: summaries are display-only. search.ts reads
 * the `-summary.txt` sidecar solely to decorate result output; summary
 * text is never embedded and never searched, so skipping it leaves
 * recall untouched. The summarizer, by contrast, resumes each
 * conversation through the Claude Agent SDK, which spends the user's
 * Claude quota and can stall on a permission prompt.
 */
export declare function buildSyncOptionsFromEnv(env: NodeJS.ProcessEnv): SyncOptions;
/**
 * Copy `src` into the archive at `dest` when the archive copy is missing or
 * older. This is the redaction choke point: with a redactor, the copy is
 * redacted line by line (see redaction.ts), and every downstream stage
 * (index, embeddings, summaries, show/read) reads the archive.
 *
 * `force` copies even when the mtimes say the archive is current: an append
 * within the mtime granularity (or the millisecond the rounding below adds)
 * leaves the source no newer than the archive.
 */
export declare function copyIfNewer(src: string, dest: string, redactor?: Redactor | null, tally?: FindingsTally, force?: boolean): boolean;
export declare function extractSessionIdFromPath(filePath: string): string | null;
export declare function syncConversations(sourceDir: string, destDir: string, options?: SyncOptions): Promise<SyncResult>;
