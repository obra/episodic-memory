import { FileLockOptions } from './file-lock.js';
export type SupervisorResult = {
    kind: 'completed';
    code: number;
} | {
    kind: 'skipped';
    reason: string;
};
export interface SupervisorOptions {
    lockPath: string;
    workerScript: string;
    workerArgs?: string[];
    workerEnv?: NodeJS.ProcessEnv;
    handshakeTimeoutMs?: number;
    workerTimeoutMs?: number;
    terminationGraceMs?: number;
    lockOptions?: FileLockOptions;
    workerStdio?: 'inherit' | 'ignore';
}
export declare function runSyncSupervisor(options: SupervisorOptions): Promise<SupervisorResult>;
export declare function authorizeWorkerFromSupervisor(timeoutMs?: number): Promise<void>;
