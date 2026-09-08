import { describe, it, expect } from 'vitest';
import { formatConversationAsMarkdown } from '../src/show.js';

function ompJsonl(): string {
  const lines = [
    { type: 'session', id: 'omp_sess_show', timestamp: '2026-04-01T00:00:00Z', cwd: '/work/show-project' },
    {
      type: 'message',
      id: 'u1',
      parentId: null,
      timestamp: '2026-04-01T00:00:01Z',
      message: { role: 'user', content: [{ type: 'text', text: 'Please render an OMP transcript.' }] },
    },
    {
      type: 'message',
      id: 'a1',
      parentId: 'u1',
      timestamp: '2026-04-01T00:00:02Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'HIDDEN chain of thought.' },
          { type: 'text', text: 'OMP transcripts render as markdown.' },
        ],
      },
    },
  ];
  return lines.map(line => JSON.stringify(line)).join('\n');
}

describe('show command - OMP markdown formatting', () => {
  it('detects an OMP transcript and renders user + assistant text, excluding thinking', () => {
    const markdown = formatConversationAsMarkdown(ompJsonl());

    expect(markdown).toMatch(/Oh My Pi|OMP/);
    expect(markdown).toContain('omp_sess_show');
    expect(markdown).toContain('Please render an OMP transcript.');
    expect(markdown).toContain('OMP transcripts render as markdown.');
    expect(markdown).not.toContain('HIDDEN chain of thought');
  });
});
