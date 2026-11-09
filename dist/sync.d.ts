import { type RedactionFinding, type Redactor } from './redaction.js';
export { shouldSkipConversation } from './record-admission.js';
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
export declare function extractSessionIdFromPath(filePath: string): string | null;
export declare function syncConversations(sourceDir: string, destDir: string, options?: SyncOptions): Promise<SyncResult>;
