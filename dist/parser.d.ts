import { ConversationExchange } from './types.js';
export declare function parseConversation(filePath: string, projectName: string, archivePath: string): Promise<ConversationExchange[]>;
/**
 * Convenience function to parse a conversation file
 * Extracts project name from the file path and returns exchanges with metadata
 */
export declare function parseConversationFile(filePath: string): Promise<{
    project: string;
    exchanges: ConversationExchange[];
}>;
