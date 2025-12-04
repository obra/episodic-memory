import { describe, it, expect } from 'vitest';
import { searchMultipleConcepts } from '../src/search.js';

describe('multi-concept search', () => {
  it('should find conversations matching all concepts', async () => {
    // This test will use the actual database
    // Looking for conversations that discuss both "React Router" AND "authentication"
    const resultWithPagination = await searchMultipleConcepts(['React', 'Router'], { limit: 5 });

    // Should return results
    expect(resultWithPagination).toBeDefined();
    expect(resultWithPagination.results).toBeDefined();
    expect(Array.isArray(resultWithPagination.results)).toBe(true);

    // Results should be sorted by average similarity
    if (resultWithPagination.results.length > 1) {
      expect(resultWithPagination.results[0].averageSimilarity).toBeGreaterThanOrEqual(resultWithPagination.results[1].averageSimilarity);
    }
  });

  it('should have low similarity for unrelated concepts', async () => {
    const resultWithPagination = await searchMultipleConcepts(['xyzabc123', 'qwerty789'], { limit: 5 });

    expect(resultWithPagination).toBeDefined();
    expect(resultWithPagination.results).toBeDefined();
    expect(Array.isArray(resultWithPagination.results)).toBe(true);
    // Might return some results (weak matches)
    // but average similarity should be very low
    if (resultWithPagination.results.length > 0) {
      expect(resultWithPagination.results[0].averageSimilarity).toBeLessThan(0.1); // < 10%
    }
  });

  it('should respect limit parameter', async () => {
    const resultWithPagination = await searchMultipleConcepts(['React', 'Router'], { limit: 2 });

    expect(resultWithPagination.results.length).toBeLessThanOrEqual(2);
  });

  it('should include similarity scores for each concept', async () => {
    const resultWithPagination = await searchMultipleConcepts(['React', 'Router'], { limit: 1 });

    if (resultWithPagination.results.length > 0) {
      expect(resultWithPagination.results[0].conceptSimilarities).toBeDefined();
      expect(resultWithPagination.results[0].conceptSimilarities?.length).toBe(2);
      expect(resultWithPagination.results[0].averageSimilarity).toBeDefined();
    }
  });
});
