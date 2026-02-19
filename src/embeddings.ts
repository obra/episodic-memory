// No top-level import of @xenova/transformers — loaded lazily to avoid
// multi-GB ONNX runtime loading in MCP server processes that never search.

let embeddingPipeline: any = null;

export async function initEmbeddings(): Promise<void> {
  if (!embeddingPipeline) {
    console.log('Loading embedding model (first run may take time)...');
    const { pipeline } = await import('@xenova/transformers');
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
    console.log('Embedding model loaded');
  }
}

export function resetEmbeddings(): void {
  embeddingPipeline = null;
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

  const embedding = Array.from(output.data) as number[];

  // Free the ONNX tensor to prevent unbounded memory growth during batch operations.
  // dispose() exists at runtime but is missing from @xenova/transformers v2 type definitions.
  if (typeof output.dispose === 'function') {
    output.dispose();
  }

  return embedding;
}

export async function generateExchangeEmbedding(
  userMessage: string,
  assistantMessage: string,
  toolNames?: string[]
): Promise<number[]> {
  // Combine user question, assistant answer, and tools used for better searchability
  let combined = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;

  // Include tool names in embedding for tool-based searches
  if (toolNames && toolNames.length > 0) {
    combined += `\n\nTools: ${toolNames.join(', ')}`;
  }

  return generateEmbedding(combined);
}
