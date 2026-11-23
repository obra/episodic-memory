import { ConversationExchange } from './types.js';
/**
 * Codex marks review, guardian and spawned-agent rollouts with
 * session_meta.source = {subagent: ...}; user-started sessions use a string
 * source ("cli", "exec", "vscode").
 */
export declare function isCodexSubagentSource(source: unknown): boolean;
/**
 * The first session_meta payload of a Codex rollout, which describes the
 * rollout itself. Forked subagent rollouts embed a copy of the parent
 * thread's session_meta after their own, so later ones must be ignored.
 */
export declare function readCodexSessionMeta(filePath: string): Promise<{
    id?: string;
    source?: unknown;
} | undefined>;
export declare function parseConversation(filePath: string, projectName: string, archivePath: string): Promise<ConversationExchange[]>;
/**
 * Cursor transcripts carry no workspace field; recover the working directory
 * from tool-call inputs: explicit cwd/working_directory values when present,
 * otherwise (with `useFilePathFallback`) the longest common directory prefix
 * of absolute paths the tools touched. The fallback is for the legacy vscdb
 * importer, which has no other signal; live transcripts have the project slug
 * in their path, which beats prefix guessing when no explicit cwd exists.
 */
export declare function detectCursorCwd(toolInputs: unknown[], useFilePathFallback?: boolean): string | undefined;
/**
 * Convenience function to parse a conversation file
 * Extracts project name from the file path and returns exchanges with metadata
 */
export declare function parseConversationFile(filePath: string): Promise<{
    project: string;
    exchanges: ConversationExchange[];
}>;
