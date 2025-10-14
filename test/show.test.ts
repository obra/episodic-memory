import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { formatConversationAsMarkdown, formatConversationAsHTML } from '../src/show.js';

describe('show command - markdown formatting', () => {
  const fixturesDir = join(import.meta.dirname, 'fixtures');

  it('should format a simple user-assistant exchange', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const markdown = formatConversationAsMarkdown(jsonl);

    // Should include user messages
    expect(markdown).toMatch(/\*\*User\*\*/);
    expect(markdown).toContain('being very tentative');

    // Should include assistant messages (shown as Agent in main thread)
    expect(markdown).toMatch(/\*\*Agent\*\*/);
    expect(markdown).toContain('Looking at your instructions');

    // Should show timestamps
    expect(markdown).toMatch(/9\/19\/2025|2025-09-19/);
  });

  it('should include tool calls in the output', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const markdown = formatConversationAsMarkdown(jsonl);

    // Should show tool use
    expect(markdown).toContain('mcp__secret-journal__process_thoughts');
    expect(markdown).toContain('**Tool Use:**');
  });

  it('should include tool results', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const markdown = formatConversationAsMarkdown(jsonl);

    // Should show tool results (now inline with tool use)
    expect(markdown).toContain('**Result:**');
    expect(markdown).toContain('Thoughts recorded successfully');
  });

  it('should preserve message hierarchy with parentUuid', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const markdown = formatConversationAsMarkdown(jsonl);

    // Messages should appear in conversation order
    const userIndex = markdown.indexOf('being very tentative');
    const assistantIndex = markdown.indexOf('Looking at your instructions');
    const toolIndex = markdown.indexOf('mcp__secret-journal__process_thoughts');

    expect(userIndex).toBeLessThan(assistantIndex);
    expect(assistantIndex).toBeLessThan(toolIndex);
  });

  it('should include metadata (session, project, git branch)', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const markdown = formatConversationAsMarkdown(jsonl);

    // Should show metadata at top
    expect(markdown).toContain('Session ID:');
    expect(markdown).toContain('67a8478e-78dc-44ab-82ea-f65c8ead85f6');
    expect(markdown).toContain('Git Branch:');
    expect(markdown).toContain('streaming');
  });

  it('should indicate sidechains if present', () => {
    // For now we test the structure - will need a fixture with sidechains later
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const markdown = formatConversationAsMarkdown(jsonl);

    // Should have structure that could show sidechains
    expect(markdown).toBeTruthy();
  });

  it('should handle token usage information', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const markdown = formatConversationAsMarkdown(jsonl);

    // Should include usage stats (now in compact inline format)
    expect(markdown).toMatch(/in: \d+/);
    expect(markdown).toMatch(/out: \d+/);
  });
});

describe('show command - HTML formatting', () => {
  const fixturesDir = join(import.meta.dirname, 'fixtures');

  it('should generate valid HTML with DOCTYPE and metadata', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const html = formatConversationAsHTML(jsonl);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain('<title>');
  });

  it('should include CSS styling', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const html = formatConversationAsHTML(jsonl);

    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
    expect(html).toContain('font-family');
  });

  it('should render user and assistant messages', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const html = formatConversationAsHTML(jsonl);

    expect(html).toContain('User');
    expect(html).toContain('Agent'); // Assistant shows as Agent in main thread
    expect(html).toContain('being very tentative');
    expect(html).toContain('Looking at your instructions');
  });

  it('should render tool calls with proper formatting', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const html = formatConversationAsHTML(jsonl);

    expect(html).toContain('mcp__secret-journal__process_thoughts');
    expect(html).toContain('Tool Use');
  });

  it('should include session metadata', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const html = formatConversationAsHTML(jsonl);

    expect(html).toContain('67a8478e-78dc-44ab-82ea-f65c8ead85f6');
    expect(html).toContain('streaming');
  });
});
