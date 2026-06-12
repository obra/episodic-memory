import { ConversationExchange } from './types.js';
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
