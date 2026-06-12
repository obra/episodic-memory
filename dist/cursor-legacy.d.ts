export declare function getDefaultCursorVscdbPath(): string | undefined;
/**
 * Collect composer IDs that already have live agent transcripts under
 * <cursorDir>/projects/<slug>/agent-transcripts/<uuid>/, so the importer
 * doesn't export conversations sync already picks up from there.
 */
export declare function collectLiveTranscriptIds(cursorProjectsDir: string): Set<string>;
export interface CursorLegacyImportOptions {
    dbPath: string;
    exportDir: string;
    /** Composer IDs covered by live agent transcripts (skipped). */
    liveTranscriptIds?: Set<string>;
    /** Re-export conversations whose output file already exists. */
    force?: boolean;
    /** Report what would be exported without writing files. */
    dryRun?: boolean;
}
export interface CursorLegacyImportResult {
    exported: number;
    skippedLive: number;
    skippedExisting: number;
    skippedEmpty: number;
    errors: Array<{
        composerId: string;
        error: string;
    }>;
}
export declare function importCursorLegacy(options: CursorLegacyImportOptions): CursorLegacyImportResult;
