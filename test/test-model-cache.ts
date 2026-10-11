import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const testModelCacheDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'tmp', 'test-model-cache'
);
