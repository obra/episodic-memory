import { initEmbeddings } from '../src/embeddings.js';
import { testModelCacheDir } from '../test/test-model-cache.js';

process.env.EPISODIC_MEMORY_MODEL_CACHE_DIR = testModelCacheDir;

try {
  await initEmbeddings();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Test embedding model preparation failed: ${message}`);
  process.exitCode = 1;
}
