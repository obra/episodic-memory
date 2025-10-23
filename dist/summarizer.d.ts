import { ConversationExchange } from './types.js';
export declare function formatConversationText(exchanges: ConversationExchange[]): string;
export declare function summarizeConversation(exchanges: ConversationExchange[], sessionId?: string): Promise<string>;
