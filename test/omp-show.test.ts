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

  it('renders turns whose parent is a non-message entry in a title-first file', () => {
    const lines = [
      { type: 'title', v: 1, title: 'Show layout', pad: '  ' },
      { type: 'session', id: 'omp_sess_layout', timestamp: '2026-09-01T00:00:00Z', cwd: '/work/layout' },
      { type: 'model_change', id: 'm0', parentId: null, model: 'x/y' },
      { type: 'message', id: 'u1', parentId: 'm0', message: { role: 'user', content: 'Early question' } },
      { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: 'Early answer' } },
      { type: 'custom', id: 'c1', parentId: 'a1' },
      { type: 'message', id: 'u2', parentId: 'c1', message: { role: 'user', content: 'Late question' } },
      { type: 'message', id: 'a2', parentId: 'u2', message: { role: 'assistant', content: 'Late answer' } },
    ];
    const markdown = formatConversationAsMarkdown(lines.map(line => JSON.stringify(line)).join('\n'));

    const order = ['Early question', 'Early answer', 'Late question', 'Late answer'].map(t => markdown.indexOf(t));
    expect(order.every(i => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
