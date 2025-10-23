export interface IndexStats {
    totalConversations: number;
    conversationsWithSummaries: number;
    conversationsWithoutSummaries: number;
    totalExchanges: number;
    dateRange?: {
        earliest: string;
        latest: string;
    };
    projectCount: number;
    topProjects?: Array<{
        project: string;
        count: number;
    }>;
    databaseSize?: string;
}
export declare function getIndexStats(dbPath?: string): Promise<IndexStats>;
export declare function formatStats(stats: IndexStats): string;
