export interface OpencodeExportResult {
    exported: number;
    skipped: number;
    errors: Array<{
        sessionId?: string;
        error: string;
    }>;
    dbPath: string;
    transcriptDir: string;
}
export declare function getOpencodeTranscriptFilePath(transcriptDir: string, input: {
    sessionId: string;
    directory: string;
}): string;
export declare function exportOpencodeSessions(options?: {
    dbPath?: string;
    transcriptDir?: string;
}): OpencodeExportResult;
