import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('embeddings', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should not import @xenova/transformers at module load time', async () => {
    let transformersImported = false;

    vi.doMock('@xenova/transformers', () => {
      transformersImported = true;
      const mockPipeline = vi.fn().mockResolvedValue({
        data: new Float32Array(384).fill(0.1),
        dispose: vi.fn()
      });
      return { pipeline: vi.fn().mockResolvedValue(mockPipeline) };
    });

    // Importing the module should NOT trigger @xenova/transformers import
    await import('../src/embeddings.js');
    expect(transformersImported).toBe(false);

    // Only when we actually generate an embedding should it load
    const { generateEmbedding } = await import('../src/embeddings.js');
    await generateEmbedding('test');
    expect(transformersImported).toBe(true);
  });

  it('should dispose tensor after extracting embedding data', async () => {
    const disposeFn = vi.fn();
    const mockPipeline = vi.fn().mockResolvedValue({
      data: new Float32Array(384).fill(0.1),
      dispose: disposeFn
    });

    vi.doMock('@xenova/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(mockPipeline)
    }));

    const { generateEmbedding } = await import('../src/embeddings.js');
    await generateEmbedding('test text');

    expect(disposeFn).toHaveBeenCalledOnce();
  });

  it('should not throw if dispose is not available on output', async () => {
    const mockPipeline = vi.fn().mockResolvedValue({
      data: new Float32Array(384).fill(0.1)
      // No dispose method — simulates older library versions
    });

    vi.doMock('@xenova/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(mockPipeline)
    }));

    const { generateEmbedding } = await import('../src/embeddings.js');
    const result = await generateEmbedding('test text');

    expect(result).toHaveLength(384);
  });

  it('should return correct embedding values after disposal', async () => {
    const disposeFn = vi.fn();
    const mockPipeline = vi.fn().mockResolvedValue({
      data: new Float32Array(384).fill(0.42),
      dispose: disposeFn
    });

    vi.doMock('@xenova/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(mockPipeline)
    }));

    const { generateEmbedding } = await import('../src/embeddings.js');
    const result = await generateEmbedding('test text');

    expect(result).toHaveLength(384);
    expect(result[0]).toBeCloseTo(0.42);
    expect(disposeFn).toHaveBeenCalledOnce();
  });
});
