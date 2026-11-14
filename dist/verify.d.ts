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
    screeningRejected: Array<{
        path: string;
    }>;
    screeningUnavailable: Array<{
        path: string;
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
export declare function repairIndex(issues: VerificationResult): Promise<void>;
