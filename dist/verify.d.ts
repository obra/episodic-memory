export interface VerificationResult {
    missing: Array<{
        path: string;
        reason: string;
    }>;
    orphaned: Array<{
        uuid: string;
        path: string;
    }>;
    outdated: Array<{
        path: string;
        fileTime: number;
        dbTime: number;
    }>;
    corrupted: Array<{
        path: string;
        error: string;
    }>;
    /** Archived conversations with a real summary but no rows in the index (e.g. after the database was rebuilt). */
    unindexed: Array<{
        path: string;
    }>;
}
export declare function verifyIndex(): Promise<VerificationResult>;
export declare function repairIndex(issues: VerificationResult): Promise<void>;
