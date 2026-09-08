import { describe, it, expect, afterEach } from 'vitest';
import { resolveIntraOpThreads } from '../src/embeddings.js';

const ENV_KEY = 'EPISODIC_MEMORY_EMBED_THREADS';

describe('resolveIntraOpThreads', () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('honors a positive integer override', () => {
    process.env[ENV_KEY] = '4';
    expect(resolveIntraOpThreads()).toBe(4);
  });

  it('treats 0 as "use onnxruntime default" (null)', () => {
    process.env[ENV_KEY] = '0';
    expect(resolveIntraOpThreads()).toBeNull();
  });

  it('treats a non-numeric override as default (null)', () => {
    process.env[ENV_KEY] = 'nope';
    expect(resolveIntraOpThreads()).toBeNull();
  });

  it('defaults to a small cap on Apple Silicon and null elsewhere when unset', () => {
    delete process.env[ENV_KEY];
    const result = resolveIntraOpThreads();
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      expect(result).toBe(2);
    } else {
      expect(result).toBeNull();
    }
  });
});
