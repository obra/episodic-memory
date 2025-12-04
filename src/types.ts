export interface ToolCall {
  id: string;
  exchangeId: string;
  toolName: string;
  toolInput?: any;
  toolResult?: string;
  isError: boolean;
  timestamp: string;
}

export interface ConversationExchange {
  id: string;
  project: string;
  timestamp: string;
  userMessage: string;
  assistantMessage: string;
  archivePath: string;
  lineStart: number;
  lineEnd: number;

  // Conversation structure
  parentUuid?: string;
  isSidechain?: boolean;

  // Session context
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  claudeVersion?: string;

  // Thinking metadata
  thinkingLevel?: string;
  thinkingDisabled?: boolean;
  thinkingTriggers?: string; // JSON array

  // Tool calls (populated separately)
  toolCalls?: ToolCall[];
}

export interface SearchResult {
  exchange: ConversationExchange;
  similarity: number;
  snippet: string;
}

export interface MultiConceptResult {
  exchange: ConversationExchange;
  snippet: string;
  conceptSimilarities: number[];
  averageSimilarity: number;
}

/**
 * Pagination metadata for conversation reading
 */
export interface ReadPaginationMetadata {
  /** Total number of lines in the file */
  totalLines: number;

  /** File size in KB */
  totalSizeKB: number;

  /** First line being shown (1-indexed) */
  startLine: number;

  /** Last line being shown (1-indexed) */
  endLine: number;

  /** Whether there are more lines after endLine */
  hasMore: boolean;

  /** Suggested next range if hasMore is true */
  suggestedNextRange?: { start: number; end: number };
}

/**
 * Result of formatting a conversation with pagination
 */
export interface PaginatedConversation {
  /** Formatted conversation content */
  content: string;

  /** Pagination metadata */
  metadata: ReadPaginationMetadata;
}
