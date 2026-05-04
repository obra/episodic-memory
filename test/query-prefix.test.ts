import { describe, it, expect } from 'vitest';
import { BGE_QUERY_PREFIX, withQueryPrefix } from '../src/embeddings.js';

describe('query prefix for bge-small', () => {
  it('exports the official BGE retrieval prefix', () => {
    expect(BGE_QUERY_PREFIX).toBe('Represent this sentence for searching relevant passages: ');
  });

  it('withQueryPrefix prepends the prefix to a query string', () => {
    expect(withQueryPrefix('how do I fix the auth bug')).toBe(
      'Represent this sentence for searching relevant passages: how do I fix the auth bug'
    );
  });

  it('withQueryPrefix is idempotent on already-prefixed inputs', () => {
    const already = BGE_QUERY_PREFIX + 'something';
    expect(withQueryPrefix(already)).toBe(already);
  });
});
