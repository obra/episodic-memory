import Anthropic from '@anthropic-ai/sdk';
let client = null;
function getClient() {
    if (!client) {
        const apiKey = process.env.ANTHROPIC_API_KEY || process.env.EPISODIC_MEMORY_API_TOKEN;
        const baseURL = process.env.EPISODIC_MEMORY_API_BASE_URL;
        client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
    }
    return client;
}
export async function callHaiku(systemPrompt, userMessage, maxTokens = 2048) {
    const model = process.env.EPISODIC_MEMORY_FACT_MODEL || 'claude-haiku-4-5-20251001';
    const anthropic = getClient();
    const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
    });
    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.text || '';
}
export function parseJsonResponse(text) {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
        || text.match(/(\[[\s\S]*\])/)
        || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch)
        return null;
    try {
        return JSON.parse(jsonMatch[1]);
    }
    catch {
        return null;
    }
}
