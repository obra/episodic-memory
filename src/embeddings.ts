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

/**
 * Resolve an intra-op thread cap for the embedding session, or null to leave
 * onnxruntime at its default (one worker per core).
 *
 * Embedding is done one exchange at a time (batch=1) throughout indexing, sync,
 * and the re-embed migration. At that size onnxruntime-node's default intra-op
 * thread pool fans each tiny int8 matmul across every core, which on Apple
 * Silicon pegs ~5 cores for almost no throughput gain and makes a bulk re-embed
 * hog the whole machine. Capping intra-op threads keeps embedding off the
 * user's cores; measured on an M-series Mac, a cap of 2 is as fast or faster
 * than the uncapped default while using ~1.7 cores instead of ~5 (and pulls
 * further ahead when the machine is otherwise busy, since it stops the pool
 * from oversubscribing).
 *
 * This stays on the same CPU / q8 execution provider, so embeddings are
 * bit-identical to the uncapped output — no re-index is triggered. (CoreML and
 * WebGPU were evaluated and rejected: on this quantized model they either run
 * far slower and never leave the CPU, or require an fp32 model whose vectors
 * differ from the stored q8 ones and would force a full re-index.)
 *
 * Override with EPISODIC_MEMORY_EMBED_THREADS: a positive integer sets the cap;
 * 0 (or any non-positive/invalid value) restores onnxruntime's default.
 */
export function resolveIntraOpThreads(): number | null {
  const override = process.env.EPISODIC_MEMORY_EMBED_THREADS;
  if (override !== undefined) {
    const n = Number.parseInt(override, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 2;
  }
  return null;
}

let embeddingPipeline: FeatureExtractionPipeline | null = null;

export async function initEmbeddings(): Promise<void> {
  if (!embeddingPipeline) {
    console.error('Loading embedding model (first run may take time)...');
    const options: Parameters<typeof pipeline>[2] = {
      dtype: MODEL_DTYPE,
      progress_callback: () => {},
    };
    const intraOpThreads = resolveIntraOpThreads();
    if (intraOpThreads !== null) {
      options.session_options = {
        intraOpNumThreads: intraOpThreads,
        interOpNumThreads: 1,
      };
    }
    embeddingPipeline = await pipeline('feature-extraction', MODEL_ID, options);
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
