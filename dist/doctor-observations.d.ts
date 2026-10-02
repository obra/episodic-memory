import { spawnSync } from 'child_process';
export interface NativeObservation {
    output: string;
    failure?: string;
}
export declare function captureNative(command: string, args: string[], env?: NodeJS.ProcessEnv, execute?: typeof spawnSync): NativeObservation;
/** Trust the native materialized plugin detail, not a mutable source directory or inferred cache path. */
export declare function pluginMcpDeclaration(detail: unknown, expectedId: string): boolean | undefined;
