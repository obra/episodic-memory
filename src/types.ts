export interface ConversationExchange {
  id: string;
  project: string;
  timestamp: string;
  userMessage: string;
  assistantMessage: string;
  archivePath: string;
  lineStart: number;
  lineEnd: number;
}

export interface SearchResult {
  exchange: ConversationExchange;
  similarity: number;
  snippet: string;
}
