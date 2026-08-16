export declare const CACHE_LIMIT_BYTES: number;
export declare const FREE_RESERVE_BYTES: number;
export declare const RUN_LIMIT_BYTES: number;
export declare const RUN_LIMIT_FILES = 200;
export declare const RUN_LIMIT_MS: number;
export interface CapacityResult {
    allowed: boolean;
    reason?: string;
}
export declare function checkCacheCapacity(cacheBytes: number, nextBytes: number, freeBytes: number): CapacityResult;
export declare class RunBudget {
    readonly startedAtMs: number;
    bytes: number;
    files: number;
    constructor(options?: {
        startedAtMs?: number;
    });
    canStart(nextBytes: number, nowMs?: number): CapacityResult;
    record(bytes: number): void;
}
export interface ObjectProof {
    bytes: number;
    sha256: string;
}
interface RcloneOptions {
    executable?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
}
export declare class RcloneTransport {
    private readonly executable;
    private readonly env;
    private readonly timeoutMs;
    constructor(options?: RcloneOptions);
    copyTo(source: string, destination: string): Promise<void>;
    verifyRemote(localPath: string, remoteKey: string): Promise<ObjectProof>;
    uploadVerified(localPath: string, remoteKey: string): Promise<ObjectProof>;
    downloadVerified(remoteKey: string, localPath: string, expected: ObjectProof): Promise<void>;
    private run;
    private streamHash;
}
export declare function hashFile(filePath: string): Promise<ObjectProof>;
export {};
