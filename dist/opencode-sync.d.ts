import { type Redactor } from './redaction.js';
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
    /** `undefined` loads from the environment (strict mode throws on bad rules); `null` disables. */
    redactor?: Redactor | null;
}): OpencodeExportResult;
