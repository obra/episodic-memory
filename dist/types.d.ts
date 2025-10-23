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
    parentUuid?: string;
    isSidechain?: boolean;
    sessionId?: string;
    cwd?: string;
    gitBranch?: string;
    claudeVersion?: string;
    thinkingLevel?: string;
    thinkingDisabled?: boolean;
    thinkingTriggers?: string;
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
