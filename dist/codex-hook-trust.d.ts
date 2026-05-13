export type CodexHookTrustState = 'trusted' | 'untrusted' | 'modified' | 'not_found' | 'unknown';
export declare function trustStateFromHooksList(result: unknown): CodexHookTrustState;
export declare function detectCodexHookTrustState(codexHome: string, cwd: string, timeoutMs?: number): Promise<CodexHookTrustState>;
