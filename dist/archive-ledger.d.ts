import type Database from 'better-sqlite3';
export type SummaryState = 'missing' | 'ready' | 'empty' | 'error';
export type UploadState = 'uploaded';
export interface ArchiveObjectRecord {
    id: string;
    remoteKey: string;
    project: string;
    sha256: string;
    sizeBytes: number;
    lineCount: number;
    sourceMtimeMs: number;
    summaryText: string | null;
    summaryState: SummaryState;
    uploadState: UploadState;
    uploadedAtMs: number;
    verifiedAtMs: number;
}
export declare function ensureArchiveLedger(db: Database.Database): void;
export declare function putArchiveObject(db: Database.Database, record: ArchiveObjectRecord): void;
export declare function getArchiveObject(db: Database.Database, identity: string): ArchiveObjectRecord | null;
