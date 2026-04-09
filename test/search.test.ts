import { describe, expect, it } from 'vitest';
import { normalizedL2DistanceToSimilarity } from '../src/search.js';

describe('normalizedL2DistanceToSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(normalizedL2DistanceToSimilarity(0)).toBe(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(normalizedL2DistanceToSimilarity(Math.sqrt(2))).toBeCloseTo(0, 10);
  });

  it('returns -1 for opposite vectors', () => {
    expect(normalizedL2DistanceToSimilarity(2)).toBe(-1);
  });

  it('clamps tiny floating point spillover into the valid cosine range', () => {
    expect(normalizedL2DistanceToSimilarity(2.0000001)).toBe(-1);
  });
});
