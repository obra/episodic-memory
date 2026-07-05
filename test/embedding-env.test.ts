import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The embedding model id and task prefixes are read from env at module load,
// so each test re-imports a fresh copy of the module via vi.resetModules().
const ENV_KEYS = [
  'EPISODIC_MEMORY_EMBEDDING_MODEL',
  'EPISODIC_MEMORY_EMBEDDING_QUERY_PREFIX',
  'EPISODIC_MEMORY_EMBEDDING_PASSAGE_PREFIX',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

describe('embedding env overrides', () => {
  it('defaults to the BGE query prefix when env is unset', async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const { BGE_QUERY_PREFIX } = await import('../src/embeddings.js');
    expect(BGE_QUERY_PREFIX).toBe('Represent this sentence for searching relevant passages: ');
  });

  it('EPISODIC_MEMORY_EMBEDDING_QUERY_PREFIX overrides the query prefix', async () => {
    process.env.EPISODIC_MEMORY_EMBEDDING_QUERY_PREFIX = 'query: ';
    const { BGE_QUERY_PREFIX, withQueryPrefix } = await import('../src/embeddings.js');
    expect(BGE_QUERY_PREFIX).toBe('query: ');
    expect(withQueryPrefix('워크트리 브랜치 규칙')).toBe('query: 워크트리 브랜치 규칙');
  });

  it('empty-string query prefix is honored (?? semantics, not ||)', async () => {
    process.env.EPISODIC_MEMORY_EMBEDDING_QUERY_PREFIX = '';
    const { BGE_QUERY_PREFIX, withQueryPrefix } = await import('../src/embeddings.js');
    expect(BGE_QUERY_PREFIX).toBe('');
    expect(withQueryPrefix('plain query')).toBe('plain query');
  });

  it('withQueryPrefix stays idempotent under an overridden prefix', async () => {
    process.env.EPISODIC_MEMORY_EMBEDDING_QUERY_PREFIX = 'query: ';
    const { withQueryPrefix } = await import('../src/embeddings.js');
    expect(withQueryPrefix(withQueryPrefix('doubled?'))).toBe('query: doubled?');
  });
});
