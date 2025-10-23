import { pipeline } from '@xenova/transformers';
let embeddingPipeline = null;
export async function initEmbeddings() {
    if (!embeddingPipeline) {
        console.log('Loading embedding model (first run may take time)...');
        embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('Embedding model loaded');
    }
}
export async function generateEmbedding(text) {
    if (!embeddingPipeline) {
        await initEmbeddings();
    }
    // Truncate text to avoid token limits (512 tokens max for this model)
    const truncated = text.substring(0, 2000);
    const output = await embeddingPipeline(truncated, {
        pooling: 'mean',
        normalize: true
    });
    return Array.from(output.data);
}
export async function generateExchangeEmbedding(userMessage, assistantMessage, toolNames) {
    // Combine user question, assistant answer, and tools used for better searchability
    let combined = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;
    // Include tool names in embedding for tool-based searches
    if (toolNames && toolNames.length > 0) {
        combined += `\n\nTools: ${toolNames.join(', ')}`;
    }
    return generateEmbedding(combined);
}
