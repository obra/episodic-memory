export declare function initEmbeddings(): Promise<void>;
export declare function generateEmbedding(text: string): Promise<number[]>;
export declare function generateExchangeEmbedding(userMessage: string, assistantMessage: string, toolNames?: string[]): Promise<number[]>;
