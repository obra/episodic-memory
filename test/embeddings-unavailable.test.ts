import { describe, it, expect, vi } from 'vitest';

// Simulate the real-world failure: @huggingface/transformers eagerly requires
// `sharp`, and on hosts where sharp's native binding can't dlopen libvips the
// module blows up (#135). Throwing getters reproduce that — importing the
// module succeeds, but the first property access inside initEmbeddings raises
// the native error, which initEmbeddings must convert into a typed error while
// preserving the underlying cause. (A factory that throws at module eval is
// intercepted and re-messaged by vitest, so a getter models it more faithfully.)
vi.mock('@huggingface/transformers', () => {
  const boom = () => {
    throw new Error('ERR_DLOPEN_FAILED: libvips-cpp.so.8.17.3: cannot open shared object file');
  };
  return {
    get env() { return boom(); },
    get pipeline() { return boom(); },
  };
});

import { initEmbeddings, EmbeddingsUnavailableError } from '../src/embeddings.js';

describe('embeddings — backend load failure (#135)', () => {
  it('initEmbeddings rejects with EmbeddingsUnavailableError instead of an opaque native crash', async () => {
    await expect(initEmbeddings()).rejects.toBeInstanceOf(EmbeddingsUnavailableError);
  });

  it('the error is actionable (mentions the likely cause) and preserves the underlying cause', async () => {
    let caught: unknown;
    try {
      await initEmbeddings();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EmbeddingsUnavailableError);
    const err = caught as EmbeddingsUnavailableError;
    expect(err.message).toMatch(/sharp|libvips|transformers/i);
    expect(err.message).toMatch(/libvips-cpp\.so/);
    expect((err as any).cause).toBeInstanceOf(Error);
  });
});
