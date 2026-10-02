export type CodexHookTrustState = 'trusted' | 'untrusted' | 'modified' | 'not_found' | 'unknown';
export interface CodexHookState {
    trustState: CodexHookTrustState;
    enabledState: 'enabled' | 'disabled' | 'not_found' | 'unknown';
}
export interface CodexIntegrationState {
    hooks: CodexHookState;
    pluginListOutput?: string;
    pluginMcpDeclared?: boolean;
    failures: string[];
}
export declare function hookStateFromHooksList(result: unknown): CodexHookState;
export declare function trustStateFromHooksList(result: unknown): CodexHookTrustState;
export declare function detectCodexIntegrationState(codexHome: string, cwd: string, timeoutMs?: number): Promise<CodexIntegrationState>;
export declare function detectCodexHookState(codexHome: string, cwd: string, timeoutMs?: number): Promise<CodexHookState>;
export declare function detectCodexHookTrustState(codexHome: string, cwd: string, timeoutMs?: number): Promise<CodexHookTrustState>;
