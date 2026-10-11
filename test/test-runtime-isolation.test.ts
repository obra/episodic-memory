import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('test runtime isolation', () => {
  it('uses a repository-owned model cache and disables worker downloads', () => {
    expect(process.env.EPISODIC_MEMORY_MODEL_CACHE_DIR).toBe(path.join(projectRoot, 'tmp', 'test-model-cache'));
    expect(process.env.EPISODIC_MEMORY_OFFLINE).toBe('1');
  });

  it('does not discover ambient OMP sessions', () => {
    const configDir = process.env.EPISODIC_MEMORY_CONFIG_DIR;
    expect(configDir).toBeDefined();
    expect(process.env.OMP_HOME).toBe(path.join(path.dirname(configDir!), 'omp'));
  });
});
