import { describe, expect, it } from 'vitest';
import { l2DistanceToCosineSimilarity } from '../src/search.js';

describe('l2DistanceToCosineSimilarity', () => {
  // For unit-normalized vectors u, v:
  //   ||u - v||^2 = 2 - 2*cos(u, v)
  // so cos = 1 - d^2 / 2, where d is the Euclidean (L2) distance.

  it('returns 1 when distance is 0 (identical vectors)', () => {
    expect(l2DistanceToCosineSimilarity(0)).toBe(1);
  });

  it('returns 0 when distance is sqrt(2) (orthogonal unit vectors)', () => {
    expect(l2DistanceToCosineSimilarity(Math.sqrt(2))).toBeCloseTo(0, 10);
  });

  it('returns -1 when distance is 2 (opposite unit vectors)', () => {
    expect(l2DistanceToCosineSimilarity(2)).toBe(-1);
  });

  it('clamps tiny floating-point overshoot below -1 back to -1', () => {
    // d slightly above 2 can occur when embeddings aren't perfectly unit length
    expect(l2DistanceToCosineSimilarity(2.0000001)).toBe(-1);
  });

  it('returns 0.5 for distance = 1 (a check the formula is d^2/2, not d/2)', () => {
    // cos = 1 - 1^2/2 = 0.5
    expect(l2DistanceToCosineSimilarity(1)).toBe(0.5);
  });
});
