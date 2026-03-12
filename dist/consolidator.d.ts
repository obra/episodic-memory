import Database from 'better-sqlite3';
import type { Fact, ConsolidationResult } from './types.js';
export declare function buildConsolidationPrompt(existingFact: string, newFact: string): string;
export declare function consolidateFacts(db: Database.Database, project: string, lastConsolidatedAt: string): Promise<{
    processed: number;
    merged: number;
    contradictions: number;
    evolutions: number;
}>;
export declare function applyConsolidationResult(db: Database.Database, existingFact: Fact, newFact: Fact, result: ConsolidationResult): void;
