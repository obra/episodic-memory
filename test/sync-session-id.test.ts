import { describe, expect, it } from 'vitest';
import { extractSessionIdFromPath } from '../src/sync.js';

describe('extractSessionIdFromPath', () => {
  it('extracts Claude session IDs from plain UUID filenames', () => {
    expect(extractSessionIdFromPath('/archive/project/982581eb-41b9-46da-86c1-ac34168117a8.jsonl'))
      .toBe('982581eb-41b9-46da-86c1-ac34168117a8');
  });

  it('extracts Codex session IDs from rollout filenames', () => {
    expect(extractSessionIdFromPath('/archive/2026/05/12/rollout-2026-05-12T18-00-00-019e4c75-d5bf-7c71-9df7-77f5fb86b711.jsonl'))
      .toBe('019e4c75-d5bf-7c71-9df7-77f5fb86b711');
  });
});
