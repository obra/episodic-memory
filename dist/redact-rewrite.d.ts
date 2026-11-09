import { type RedactionFinding, type Redactor } from './redaction.js';
/**
 * Backfill for `episodic-memory redact --rewrite`: re-run redaction over data
 * written before redaction existed (or before a rule was added).
 *
 * 1. Archive: every .jsonl is redacted in place. Line count and mtime are
 *    preserved, so index line ranges stay valid and sync still sees the
 *    archive as current.
 * 2. Staging dirs (opencode / legacy Cursor exports): same, in place.
 * 3. Index: every exchanges/tool_calls row is redacted in place. Changed rows
 *    are re-embedded from the redacted text, so no vector is left that was
 *    derived from a secret.
 * 4. Summaries: a `-summary.txt` for a conversation that had findings (in the
 *    archive or the index), or one that matches a rule itself, is deleted.
 *    It was generated from unredacted text, and the next sync regenerates it
 *    from the redacted archive.
 *
 * Idempotent: a second run finds nothing to change. A dry run opens the index
 * read-only, so it doesn't create, migrate or otherwise touch it.
 */
export type EmbedFn = (user: string, assistant: string, toolNames?: string[]) => Promise<number[]>;
export interface RewriteOptions {
    archiveDir: string;
    redactor: Redactor;
    embed: EmbedFn;
    /** Count what would change without writing anything. */
    dryRun?: boolean;
    /**
     * Called once per value that would be redacted, for reviewing hits before
     * applying them. Never receives the value itself.
     */
    report?: (hit: RedactionHit) => void;
    /** Plugin-owned staging dirs to redact in place (not indexed). */
    stagingDirs?: string[];
    log?: (message: string) => void;
}
export interface RewriteResult {
    filesScanned: number;
    filesRewritten: number;
    stagingFilesRewritten: number;
    rowsUpdated: number;
    summariesRemoved: number;
    /** Rule IDs and counts only — never matched values. */
    findings: RedactionFinding[];
}
/** One redacted value, described without revealing it. */
export interface RedactionHit {
    /** Archive-relative file and 1-based line, or `index:<file>#<exchange id> <field>`. */
    location: string;
    ruleId: string;
    /** Length, character classes and entropy (see describeShape). */
    shape: string;
    /** Redacted text around the token, on one line. */
    context: string;
}
export declare function rewriteArchive(options: RewriteOptions): Promise<RewriteResult>;
