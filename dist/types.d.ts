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
export type FactCategory = 'decision' | 'preference' | 'pattern' | 'knowledge' | 'constraint';
export type FactScopeType = 'global' | 'project';
export type FactRelation = 'DUPLICATE' | 'CONTRADICTION' | 'EVOLUTION' | 'INDEPENDENT';
export interface Fact {
    id: string;
    fact: string;
    category: FactCategory;
    scope_type: FactScopeType;
    scope_project: string | null;
    source_exchange_ids: string[];
    embedding: Float32Array | null;
    created_at: string;
    updated_at: string;
    consolidated_count: number;
    is_active: boolean;
}
export interface FactRevision {
    id: string;
    fact_id: string;
    previous_fact: string;
    new_fact: string;
    reason: string | null;
    source_exchange_id: string | null;
    created_at: string;
}
export interface FactSearchResult {
    fact: Fact;
    similarity: number;
}
export interface ExtractedFact {
    fact: string;
    category: FactCategory;
    scope_type: FactScopeType;
    confidence: number;
}
export interface ConsolidationResult {
    relation: FactRelation;
    merged_fact: string;
    reason: string;
}
