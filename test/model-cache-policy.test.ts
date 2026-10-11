import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('@huggingface/transformers', () => ({
  env: { cacheDir: 'package-cache', allowLocalModels: true, allowRemoteModels: true, useBrowserCache: true },
  pipeline: vi.fn(async () => async () => ({ data: new Float32Array(384) })),
}));

describe('embedding model cache and network policy', () => {
  let directory: string;
  let previous: NodeJS.ProcessEnv;

  beforeEach(async () => {
    previous = { ...process.env };
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-model-policy-'));
    process.env.EPISODIC_MEMORY_CONFIG_DIR = path.join(directory, 'config');
    delete process.env.EPISODIC_MEMORY_MODEL_CACHE_DIR;
    delete process.env.EPISODIC_MEMORY_OFFLINE;
    vi.resetModules();
    const { env } = await import('@huggingface/transformers');
    Object.assign(env, {
      cacheDir: 'package-cache', allowLocalModels: true,
      allowRemoteModels: true, useBrowserCache: true,
    });
  });

  afterEach(() => {
    process.env = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function loadPolicy() {
    const transformers = await import('@huggingface/transformers');
    const { initEmbeddings } = await import('../src/embeddings.js');
    await initEmbeddings();
    return transformers.env;
  }

  it('keeps the model cache in the durable configuration directory by default', async () => {
    const env = await loadPolicy();
    expect(env.cacheDir).toBe(path.join(directory, 'config', 'models'));
    expect(fs.statSync(env.cacheDir).isDirectory()).toBe(true);
  });

  it('accepts an explicit cache directory without a machine-specific default', async () => {
    const modelCache = path.join(directory, 'shared-models');
    process.env.EPISODIC_MEMORY_MODEL_CACHE_DIR = modelCache;
    const env = await loadPolicy();
    expect(env.cacheDir).toBe(modelCache);
  });

  it('rejects a relative cache override whose meaning depends on cwd', async () => {
    process.env.EPISODIC_MEMORY_MODEL_CACHE_DIR = 'relative-model-cache';
    const { getModelCacheDir } = await import('../src/paths.js');
    expect(() => getModelCacheDir()).toThrow(/absolute path/);
  });

  it('blocks remote model loading only when offline mode is explicit', async () => {
    process.env.EPISODIC_MEMORY_OFFLINE = '1';
    const env = await loadPolicy();
    expect(env.allowRemoteModels).toBe(false);
  });

  it('retains first-install model download behavior by default', async () => {
    const env = await loadPolicy();
    expect(env.allowRemoteModels).toBe(true);
  });

  it.each([undefined, '0', '1'])('never re-enables host-disabled remote access with offline=%s', async offline => {
    if (offline !== undefined) process.env.EPISODIC_MEMORY_OFFLINE = offline;
    const { env } = await import('@huggingface/transformers');
    env.allowRemoteModels = false;

    await loadPolicy();

    expect(env.allowRemoteModels).toBe(false);
  });

  it.each([undefined, '1'])('preserves host-disabled local access with offline=%s', async offline => {
    if (offline !== undefined) process.env.EPISODIC_MEMORY_OFFLINE = offline;
    const { env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;

    await loadPolicy();

    expect(env.allowLocalModels).toBe(false);
  });

  it('reports an unavailable pre-seeded model clearly in offline mode', async () => {
    process.env.EPISODIC_MEMORY_OFFLINE = '1';
    const transformers = await import('@huggingface/transformers');
    vi.mocked(transformers.pipeline).mockRejectedValueOnce(new Error('model files not found'));
    const { initEmbeddings, EmbeddingsUnavailableError } = await import('../src/embeddings.js');

    let failure: unknown;
    try { await initEmbeddings(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(EmbeddingsUnavailableError);
    expect((failure as Error).message).toMatch(/offline|cache/i);
  });
});
