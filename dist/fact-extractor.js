import { callHaiku, parseJsonResponse } from './llm.js';
import { insertFact } from './fact-db.js';
import { generateEmbedding, initEmbeddings } from './embeddings.js';
const EXTRACTION_SYSTEM_PROMPT = `You are an expert at extracting long-term facts from conversations.

## Rules
- 1 fact = 1 sentence (concise)
- Ignore trivial exchanges (greetings, "yes", "thanks")
- Code snippets are NOT facts - extract only decisions/patterns
- No duplicate facts within the same batch

## scope determination
- project: specific files/paths/DB/API/framework/business logic
- global: coding style, language/response format, common tool usage

## Output format (JSON array)
[
  {
    "fact": "User uses Riverpod for state management",
    "category": "decision",
    "scope_type": "project",
    "confidence": 0.9
  }
]

## category choices
- decision: architecture/technology decisions
- preference: user preferences
- pattern: repeated patterns
- knowledge: project knowledge
- constraint: constraints

## confidence criteria
- 0.9+: explicit decision/declaration
- 0.7-0.9: inferred from behavior
- Below 0.7: do not extract`;
const BATCH_SIZE = 5;
const MAX_FACTS_PER_SESSION = 20;
const CONFIDENCE_THRESHOLD = 0.7;
export function buildExtractionPrompt(exchanges) {
    return exchanges.map((ex, i) => {
        const userSnippet = ex.user_message.slice(0, 1000);
        const assistantSnippet = ex.assistant_message.slice(0, 1000);
        return `### Exchange ${i + 1}\nUser: ${userSnippet}\nAssistant: ${assistantSnippet}`;
    }).join('\n\n');
}
export async function extractFactsFromExchanges(db, sessionId) {
    const exchanges = db.prepare(`
    SELECT id, user_message, assistant_message
    FROM exchanges
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `).all(sessionId);
    if (exchanges.length === 0)
        return [];
    const allFacts = [];
    for (let i = 0; i < exchanges.length; i += BATCH_SIZE) {
        if (allFacts.length >= MAX_FACTS_PER_SESSION)
            break;
        const batch = exchanges.slice(i, i + BATCH_SIZE);
        const prompt = buildExtractionPrompt(batch);
        try {
            const response = await callHaiku(EXTRACTION_SYSTEM_PROMPT, prompt);
            const extracted = parseJsonResponse(response);
            if (extracted && Array.isArray(extracted)) {
                for (const fact of extracted) {
                    if (fact.confidence >= CONFIDENCE_THRESHOLD && allFacts.length < MAX_FACTS_PER_SESSION) {
                        allFacts.push(fact);
                    }
                }
            }
        }
        catch (error) {
            console.error(`Batch ${Math.floor(i / BATCH_SIZE)} extraction failed:`, error);
        }
    }
    return allFacts;
}
export async function saveExtractedFacts(db, facts, project, sourceExchangeIds) {
    await initEmbeddings();
    const savedIds = [];
    for (const fact of facts) {
        const embedding = await generateEmbedding(fact.fact);
        const id = insertFact(db, {
            fact: fact.fact,
            category: fact.category,
            scope_type: fact.scope_type,
            scope_project: fact.scope_type === 'project' ? project : null,
            source_exchange_ids: sourceExchangeIds,
            embedding,
        });
        savedIds.push(id);
    }
    return savedIds;
}
export async function runFactExtraction(db, sessionId, project) {
    const facts = await extractFactsFromExchanges(db, sessionId);
    if (facts.length === 0) {
        return { extracted: 0, saved: 0 };
    }
    const exchangeIds = db.prepare('SELECT id FROM exchanges WHERE session_id = ?').all(sessionId).map((r) => r.id);
    const savedIds = await saveExtractedFacts(db, facts, project, exchangeIds);
    return { extracted: facts.length, saved: savedIds.length };
}
