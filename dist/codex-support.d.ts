export declare const MIN_CODEX_VERSION = "0.130.0";
export declare function parseCodexCliVersion(output: string): string | undefined;
export declare function compareSemver(a: string, b: string): number;
export declare function versionMeetsMinimum(version: string, minimum?: string): boolean;
export declare function codexVersionRequirementMessage(versionOutput: string): string;
