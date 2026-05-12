export type LogLevel = 'info' | 'warn' | 'error';
export declare function getLogDir(): string;
export declare function getSyncLogPath(): string;
export declare function formatLogLine(level: LogLevel, message: string): string;
export declare function appendLogLine(level: LogLevel, message: string): void;
