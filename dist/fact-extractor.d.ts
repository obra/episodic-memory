import Database from 'better-sqlite3';
import type { ExtractedFact } from './types.js';
export declare function buildExtractionPrompt(exchanges: Array<{
    user_message: string;
    assistant_message: string;
}>): string;
export declare function extractFactsFromExchanges(db: Database.Database, sessionId: string): Promise<ExtractedFact[]>;
export declare function saveExtractedFacts(db: Database.Database, facts: ExtractedFact[], project: string, sourceExchangeIds: string[]): Promise<string[]>;
export declare function runFactExtraction(db: Database.Database, sessionId: string, project: string): Promise<{
    extracted: number;
    saved: number;
}>;
