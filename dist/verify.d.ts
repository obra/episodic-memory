export interface VerificationResult {
    missing: Array<{
        path: string;
        reason: string;
    }>;
    unindexed: Array<{
        path: string;
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
    archiveRefreshes: Array<{
        path: string;
        fileTime: number;
        dbTime: number;
    }>;
    corrupted: Array<{
        path: string;
        error: string;
    }>;
}
export declare function verifyIndex(): Promise<VerificationResult>;
export declare function repairIndex(issues: Pick<VerificationResult, 'missing' | 'orphaned' | 'outdated' | 'corrupted'>): Promise<void>;
