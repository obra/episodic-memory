import { callHaiku, parseJsonResponse } from './llm.js';
import { getNewFactsSince, searchSimilarFacts, updateFact, deactivateFact, insertRevision, } from './fact-db.js';
import { initEmbeddings } from './embeddings.js';
const CONSOLIDATION_SYSTEM_PROMPT = `Compare two facts and determine their relationship.

## Relationship types (choose one)
- DUPLICATE: same content - merge
- CONTRADICTION: conflicting - new fact replaces old
- EVOLUTION: old fact evolved - update
- INDEPENDENT: separate - keep both

## Output format
{
  "relation": "DUPLICATE|CONTRADICTION|EVOLUTION|INDEPENDENT",
  "merged_fact": "final sentence for merge/replace",
  "reason": "one-line justification"
}`;
const MAX_HAIKU_CALLS = 10;
const SIMILARITY_THRESHOLD = 0.85;
export function buildConsolidationPrompt(existingFact, newFact) {
    return `Existing fact: "${existingFact}"\nNew fact: "${newFact}"`;
}
export async function consolidateFacts(db, project, lastConsolidatedAt) {
    await initEmbeddings();
    const newFacts = getNewFactsSince(db, project, lastConsolidatedAt);
    if (newFacts.length === 0) {
        return { processed: 0, merged: 0, contradictions: 0, evolutions: 0 };
    }
    let haikuCalls = 0;
    let merged = 0;
    let contradictions = 0;
    let evolutions = 0;
    for (const newFact of newFacts) {
        if (haikuCalls >= MAX_HAIKU_CALLS)
            break;
        if (!newFact.embedding)
            continue;
        // Convert Float32Array back to number[] for searchSimilarFacts
        const embeddingArray = Array.from(newFact.embedding);
        const similar = searchSimilarFacts(db, embeddingArray, project, 5, SIMILARITY_THRESHOLD);
        const candidates = similar.filter(s => s.fact.id !== newFact.id);
        if (candidates.length === 0)
            continue;
        const closest = candidates[0];
        const prompt = buildConsolidationPrompt(closest.fact.fact, newFact.fact);
        try {
            const response = await callHaiku(CONSOLIDATION_SYSTEM_PROMPT, prompt);
            haikuCalls++;
            const result = parseJsonResponse(response);
            if (!result)
                continue;
            applyConsolidationResult(db, closest.fact, newFact, result);
            switch (result.relation) {
                case 'DUPLICATE':
                    merged++;
                    break;
                case 'CONTRADICTION':
                    contradictions++;
                    break;
                case 'EVOLUTION':
                    evolutions++;
                    break;
            }
        }
        catch (error) {
            console.error(`Consolidation failed for fact ${newFact.id}:`, error);
        }
    }
    return { processed: newFacts.length, merged, contradictions, evolutions };
}
export function applyConsolidationResult(db, existingFact, newFact, result) {
    switch (result.relation) {
        case 'DUPLICATE':
            updateFact(db, existingFact.id, { consolidated_count_increment: true });
            deactivateFact(db, newFact.id);
            break;
        case 'CONTRADICTION':
            deactivateFact(db, existingFact.id);
            insertRevision(db, {
                fact_id: existingFact.id,
                previous_fact: existingFact.fact,
                new_fact: result.merged_fact || newFact.fact,
                reason: result.reason,
                source_exchange_id: null,
            });
            if (result.merged_fact) {
                updateFact(db, newFact.id, { fact: result.merged_fact });
            }
            break;
        case 'EVOLUTION':
            insertRevision(db, {
                fact_id: existingFact.id,
                previous_fact: existingFact.fact,
                new_fact: result.merged_fact || newFact.fact,
                reason: result.reason,
                source_exchange_id: null,
            });
            updateFact(db, existingFact.id, {
                fact: result.merged_fact || newFact.fact,
                consolidated_count_increment: true,
            });
            deactivateFact(db, newFact.id);
            break;
        case 'INDEPENDENT':
            // Keep both, do nothing
            break;
    }
}
