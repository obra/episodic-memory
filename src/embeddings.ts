import { pipeline, Pipeline, FeatureExtractionPipeline } from '@xenova/transformers';

let embeddingPipeline: FeatureExtractionPipeline | null = null;

export async function initEmbeddings(): Promise<void> {
  if (!embeddingPipeline) {
    console.log('Loading embedding model (first run may take time)...');
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
    console.log('Embedding model loaded');
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!embeddingPipeline) {
    await initEmbeddings();
  }

  // Truncate text to avoid token limits (512 tokens max for this model)
  const truncated = text.substring(0, 2000);

  const output = await embeddingPipeline!(truncated, {
    pooling: 'mean',
    normalize: true
  });

  return Array.from(output.data);
}

export async function generateExchangeEmbedding(
  userMessage: string,
  assistantMessage: string
): Promise<number[]> {
  // Combine user question and assistant answer for better searchability
  const combined = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;
  return generateEmbedding(combined);
}
