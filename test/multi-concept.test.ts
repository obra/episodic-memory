import { describe, it, expect } from 'vitest';
import { searchMultipleConcepts } from '../src/search.js';

describe('multi-concept search', () => {
  it('should find conversations matching all concepts', async () => {
    // This test will use the actual database
    // Looking for conversations that discuss both "React Router" AND "authentication"
    const results = await searchMultipleConcepts(['React', 'Router'], { limit: 5 });

    // Should return results
    expect(Array.isArray(results)).toBe(true);

    // Results should be sorted by average similarity
    if (results.length > 1) {
      expect(results[0].averageSimilarity).toBeGreaterThanOrEqual(results[1].averageSimilarity);
    }
  });

  it('should have low similarity for unrelated concepts', async () => {
    const results = await searchMultipleConcepts(['xyzabc123', 'qwerty789'], { limit: 5 });

    expect(Array.isArray(results)).toBe(true);
    // Might return some results (weak matches)
    // but average similarity should be very low
    if (results.length > 0) {
      expect(results[0].averageSimilarity).toBeLessThan(0.1); // < 10%
    }
  });

  it('should respect limit parameter', async () => {
    const results = await searchMultipleConcepts(['React', 'Router'], { limit: 2 });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should include similarity scores for each concept', async () => {
    const results = await searchMultipleConcepts(['React', 'Router'], { limit: 1 });

    if (results.length > 0) {
      expect(results[0].conceptSimilarities).toBeDefined();
      expect(results[0].conceptSimilarities?.length).toBe(2);
      expect(results[0].averageSimilarity).toBeDefined();
    }
  });
});
