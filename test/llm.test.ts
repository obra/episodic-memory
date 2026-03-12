import { describe, it, expect } from 'vitest';
import { parseJsonResponse } from '../src/llm.js';

describe('LLM Module', () => {
  describe('parseJsonResponse', () => {
    it('should parse raw JSON array', () => {
      const result = parseJsonResponse<any[]>('[{"fact": "test"}]');
      expect(result).toEqual([{ fact: 'test' }]);
    });

    it('should parse JSON in code block', () => {
      const text = 'Here are the facts:\n```json\n[{"fact": "test"}]\n```';
      const result = parseJsonResponse<any[]>(text);
      expect(result).toEqual([{ fact: 'test' }]);
    });

    it('should return null for invalid JSON', () => {
      expect(parseJsonResponse<any>('not json at all')).toBeNull();
    });

    it('should parse JSON object', () => {
      const result = parseJsonResponse<any>('{"relation": "DUPLICATE"}');
      expect(result).toEqual({ relation: 'DUPLICATE' });
    });

    it('should handle nested JSON in text', () => {
      const text = 'Analysis complete.\n{"relation": "EVOLUTION", "merged_fact": "updated", "reason": "changed"}';
      const result = parseJsonResponse<any>(text);
      expect(result?.relation).toBe('EVOLUTION');
    });
  });
});
