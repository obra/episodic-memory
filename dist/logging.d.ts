export type LogLevel = 'info' | 'warn' | 'error';
export declare function getLogDir(): string;
export declare function getSyncLogPath(): string;
/**
 * Lock shared by `sync-cli` and `index-cli`. The filename is an on-disk
 * contract since v1.4.2: changing it lets older sync clients race new indexers.
 */
export declare function getSyncLockPath(): string;
export declare function formatLogLine(level: LogLevel, message: string): string;
export declare function appendLogLine(level: LogLevel, message: string): void;
