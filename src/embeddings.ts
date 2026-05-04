import { pipeline, FeatureExtractionPipeline, env } from '@huggingface/transformers';

// Disable progress callbacks to prevent stdout pollution in MCP context
// In MCP, stdout is reserved for JSON-RPC communication.
env.allowLocalModels = true;
env.useBrowserCache = false;

/**
 * Embedding model configuration.
 *
 * Using BAAI's bge-small-en-v1.5 (via Xenova's ONNX export) instead of the
 * older all-MiniLM-L6-v2 — measured +6.34 R@1 on a 17K-corpus retrieval test
 * against real production data. Same 384 dimensions, so vec_exchanges schema
 * is unchanged.
 *
 * BGE models recommend prepending a task prefix to QUERY embeddings only
 * (passages/documents go through unmodified). See `withQueryPrefix` and
 * `generateQueryEmbedding` below.
 */
const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const MODEL_DTYPE = 'q8';
export const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

let embeddingPipeline: FeatureExtractionPipeline | null = null;

export async function initEmbeddings(): Promise<void> {
  if (!embeddingPipeline) {
    console.error('Loading embedding model (first run may take time)...');
    embeddingPipeline = await pipeline(
      'feature-extraction',
      MODEL_ID,
      { dtype: MODEL_DTYPE, progress_callback: () => {} }
    );
    console.error('Embedding model loaded');
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!embeddingPipeline) {
    await initEmbeddings();
  }

  // Truncate text to avoid token limits (512 tokens max for bge-small).
  // Empirically, retrieval quality is best at the 2000-char truncation limit;
  // longer inputs degrade mean-pooled embeddings.
  const truncated = text.substring(0, 2000);

  const output = await embeddingPipeline!(truncated, {
    pooling: 'mean',
    normalize: true,
  });

  return Array.from(output.data as Float32Array);
}

/**
 * Prepend the BGE retrieval prefix to a query string. Idempotent: returns
 * the input unchanged if the prefix is already present.
 */
export function withQueryPrefix(query: string): string {
  if (query.startsWith(BGE_QUERY_PREFIX)) return query;
  return BGE_QUERY_PREFIX + query;
}

/**
 * Generate an embedding for a search QUERY. Adds the model-specific prefix
 * before embedding, which gives a small but consistent recall lift on
 * retrieval tasks. Document/passage embeddings (`generateExchangeEmbedding`)
 * stay unmodified — that's the asymmetric pattern BGE models are trained for.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  return generateEmbedding(withQueryPrefix(query));
}

export async function generateExchangeEmbedding(
  userMessage: string,
  assistantMessage: string,
  toolNames?: string[]
): Promise<number[]> {
  // Combine user question, assistant answer, and tools used for better searchability
  let combined = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;

  if (toolNames && toolNames.length > 0) {
    combined += `\n\nTools: ${toolNames.join(', ')}`;
  }

  return generateEmbedding(combined);
}
