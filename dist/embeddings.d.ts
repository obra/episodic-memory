export declare const BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
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
export declare function resolveIntraOpThreads(): number | null;
export declare function initEmbeddings(): Promise<void>;
export declare function generateEmbedding(text: string): Promise<number[]>;
/**
 * Prepend the BGE retrieval prefix to a query string. Idempotent: returns
 * the input unchanged if the prefix is already present.
 */
export declare function withQueryPrefix(query: string): string;
/**
 * Generate an embedding for a search QUERY. Adds the model-specific prefix
 * before embedding, which gives a small but consistent recall lift on
 * retrieval tasks. Document/passage embeddings (`generateExchangeEmbedding`)
 * stay unmodified — that's the asymmetric pattern BGE models are trained for.
 */
export declare function generateQueryEmbedding(query: string): Promise<number[]>;
export declare function generateExchangeEmbedding(userMessage: string, assistantMessage: string, toolNames?: string[]): Promise<number[]>;
