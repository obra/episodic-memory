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
}
export declare function verifyIndex(): Promise<VerificationResult>;
export declare function repairIndex(issues: VerificationResult): Promise<void>;
