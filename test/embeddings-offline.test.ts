import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testModelCacheDir } from './test-model-cache.js';

describe('native embedding cache and host permissions', () => {
  let root: string;
  let previous: NodeJS.ProcessEnv;
  let restore: () => void;
  let attempts: number;

  beforeEach(async () => {
    previous = { ...process.env };
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-native-cache-'));
    process.env.EPISODIC_MEMORY_CONFIG_DIR = path.join(root, 'config');
    process.env.EPISODIC_MEMORY_MODEL_CACHE_DIR = path.join(root, 'models');
    process.env.EPISODIC_MEMORY_OFFLINE = '1';
    fs.cpSync(testModelCacheDir, process.env.EPISODIC_MEMORY_MODEL_CACHE_DIR, { recursive: true });
    vi.resetModules();
    const { env } = await import('@huggingface/transformers');
    const original = { cacheDir: env.cacheDir, allowLocalModels: env.allowLocalModels,
      allowRemoteModels: env.allowRemoteModels, useBrowserCache: env.useBrowserCache,
      fetch: env.fetch };
    restore = () => Object.assign(env, original);
    env.cacheDir = path.join(root, 'other-consumer-models');
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    attempts = 0;
    env.fetch = async () => { attempts++; throw new Error('Unexpected model network access'); };
  });

  afterEach(() => {
    restore?.();
    process.env = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(['offline', 'host-disabled'] as const)('loads a seeded model with zero fetch attempts in %s mode', async mode => {
    const { env } = await import('@huggingface/transformers');
    if (mode === 'host-disabled') {
      delete process.env.EPISODIC_MEMORY_OFFLINE;
      env.allowRemoteModels = false;
    }
    const { generateEmbedding } = await import('../src/embeddings.js');

    const embedding = await generateEmbedding('A source-linked conversation remains searchable after an upgrade.');

    expect(embedding).toHaveLength(384);
    expect(embedding.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...embedding)).toBeCloseTo(1);
    expect(attempts).toBe(0);
    expect(env.allowRemoteModels).toBe(false);
    expect(env.cacheDir).toBe(process.env.EPISODIC_MEMORY_MODEL_CACHE_DIR);
  });

  it.each(['empty', 'partial'] as const)('rejects an %s offline cache without attempting a model download', async state => {
    if (state === 'empty') {
      process.env.EPISODIC_MEMORY_MODEL_CACHE_DIR = path.join(root, 'empty-models');
    } else {
      fs.unlinkSync(path.join(root, 'models', 'Xenova', 'bge-small-en-v1.5', 'onnx', 'model_quantized.onnx'));
    }
    const { initEmbeddings, EmbeddingsUnavailableError } = await import('../src/embeddings.js');

    await expect(initEmbeddings()).rejects.toBeInstanceOf(EmbeddingsUnavailableError);

    expect(attempts).toBe(0);
  });

  it('preserves native refusal when local loading is host-disabled and remote loading is offline', async () => {
    const { env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    const { initEmbeddings, EmbeddingsUnavailableError } = await import('../src/embeddings.js');

    await expect(initEmbeddings()).rejects.toBeInstanceOf(EmbeddingsUnavailableError);

    expect(env.allowLocalModels).toBe(false);
    expect(env.allowRemoteModels).toBe(false);
    expect(attempts).toBe(0);
  });

  it.each(['empty', 'partial'] as const)('recovers an %s online cache through the native loader', async state => {
    delete process.env.EPISODIC_MEMORY_OFFLINE;
    const modelDir = path.join(root, 'models', 'Xenova', 'bge-small-en-v1.5');
    if (state === 'empty') {
      fs.rmSync(modelDir, { recursive: true });
    } else {
      fs.unlinkSync(path.join(modelDir, 'onnx', 'model_quantized.onnx'));
    }
    const { env } = await import('@huggingface/transformers');
    // Real tokenizer/model/cache loading, with a deterministic fixture transport.
    // This is not a live Hub availability or cold-network-download assertion.
    env.fetch = async (input, options) => {
      attempts++;
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const filename = url.pathname.split('/resolve/main/')[1];
      const source = filename && path.join(testModelCacheDir, 'Xenova', 'bge-small-en-v1.5', filename);
      if (!source || !fs.existsSync(source)) return new Response(null, { status: 404 });
      const data = fs.readFileSync(source);
      if (new Headers(options?.headers).has('Range')) {
        return new Response(data.subarray(0, 1), {
          status: 206,
          headers: { 'Content-Range': `bytes 0-0/${data.length}`, 'Content-Length': '1' },
        });
      }
      return new Response(data, { headers: { 'Content-Length': String(data.length) } });
    };
    const { generateEmbedding } = await import('../src/embeddings.js');

    const embedding = await generateEmbedding('Default downloads recover missing files without changing the model.');

    expect(embedding).toHaveLength(384);
    expect(Math.hypot(...embedding)).toBeCloseTo(1);
    expect(attempts).toBeGreaterThan(0);
    expect(env.allowRemoteModels).toBe(true);
    expect(fs.readFileSync(path.join(modelDir, 'onnx', 'model_quantized.onnx')).equals(
      fs.readFileSync(path.join(testModelCacheDir, 'Xenova', 'bge-small-en-v1.5', 'onnx', 'model_quantized.onnx'))
    )).toBe(true);
  });
});
