import { describe, it, expect } from 'vitest';
import { buildExtractionPrompt } from '../src/fact-extractor.js';

describe('Fact Extractor', () => {
  describe('buildExtractionPrompt', () => {
    it('should format exchanges into extraction prompt', () => {
      const exchanges = [
        { user_message: 'What should we use for state management?', assistant_message: 'I recommend Riverpod' },
        { user_message: 'OK let us go with that', assistant_message: 'Setting up Riverpod now' },
      ];
      const prompt = buildExtractionPrompt(exchanges);
      expect(prompt).toContain('What should we use for state management?');
      expect(prompt).toContain('Riverpod');
      expect(prompt).toContain('Exchange 1');
      expect(prompt).toContain('Exchange 2');
    });

    it('should truncate long messages to 1000 chars', () => {
      const longMsg = 'x'.repeat(2000);
      const exchanges = [{ user_message: longMsg, assistant_message: 'short' }];
      const prompt = buildExtractionPrompt(exchanges);
      // Each message truncated to 1000, so total should be much less than 2000
      expect(prompt).not.toContain('x'.repeat(1001));
    });
  });

  describe('confidence filtering logic', () => {
    it('should filter below 0.7 threshold', () => {
      const extracted = [
        { fact: 'High', category: 'decision' as const, scope_type: 'project' as const, confidence: 0.9 },
        { fact: 'Low', category: 'decision' as const, scope_type: 'project' as const, confidence: 0.5 },
        { fact: 'Border', category: 'decision' as const, scope_type: 'project' as const, confidence: 0.7 },
      ];
      const filtered = extracted.filter(f => f.confidence >= 0.7);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(f => f.fact)).toEqual(['High', 'Border']);
    });

    it('should limit to max 20 facts', () => {
      const extracted = Array.from({ length: 25 }, (_, i) => ({
        fact: `Fact ${i}`, category: 'knowledge' as const, scope_type: 'project' as const, confidence: 0.9,
      }));
      const limited = extracted.slice(0, 20);
      expect(limited).toHaveLength(20);
    });
  });
});
