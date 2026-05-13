import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { formatConversationAsMarkdown, formatConversationAsHTML } from '../src/show.js';

function codexJsonl(): string {
  return [
    {
      timestamp: '2026-05-12T18:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
        cwd: '/Users/jesse/Documents/GitHub/example-project',
        cli_version: '0.130.0',
        model_provider: 'openai',
        git: { branch: 'codex-support' }
      }
    },
    {
      timestamp: '2026-05-12T18:00:01.000Z',
      type: 'turn_context',
      payload: {
        cwd: '/Users/jesse/Documents/GitHub/example-project',
        model: 'gpt-5.2'
      }
    },
    {
      timestamp: '2026-05-12T18:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Please inspect the config loader.' }]
      }
    },
    {
      timestamp: '2026-05-12T18:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd":"sed -n 1,80p src/config.ts"}',
        call_id: 'call_config'
      }
    },
    {
      timestamp: '2026-05-12T18:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_config',
        output: 'export function loadConfig() {}'
      }
    },
    {
      timestamp: '2026-05-12T18:00:05.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'The config loader reads the default profile first.' }]
      }
    }
  ].map(line => JSON.stringify(line)).join('\n');
}

function codexJsonlWithRawHtml(): string {
  return [
    {
      timestamp: '2026-05-12T18:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
        cwd: '/Users/jesse/Documents/GitHub/example-project',
        cli_version: '0.130.0',
        model_provider: 'openai',
      }
    },
    {
      timestamp: '2026-05-12T18:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Please inspect <script>alert("message")</script>.' }]
      }
    },
    {
      timestamp: '2026-05-12T18:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd":"printf \\"<script>alert(\\\\\\"tool\\\\\\")</script>\\""}',
        call_id: 'call_html'
      }
    },
    {
      timestamp: '2026-05-12T18:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_html',
        output: '<script>alert("result")</script>'
      }
    },
    {
      timestamp: '2026-05-12T18:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Saw <b>literal markup</b> in the output.' }]
      }
    }
  ].map(line => JSON.stringify(line)).join('\n');
}

function codexJsonlWithLocalShellOutput(): string {
  return [
    {
      timestamp: '2026-05-12T18:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
        cwd: '/Users/jesse/Documents/GitHub/example-project',
        cli_version: '0.130.0',
        model_provider: 'openai',
      }
    },
    {
      timestamp: '2026-05-12T18:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Run a local shell command.' }]
      }
    },
    {
      timestamp: '2026-05-12T18:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'local_shell_call',
        call_id: 'local_shell_1',
        action: { command: ['/bin/echo', 'local shell'] }
      }
    },
    {
      timestamp: '2026-05-12T18:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'local_shell_call_output',
        call_id: 'local_shell_1',
        output: 'Exit code: 0\nOutput:\nlocal shell'
      }
    },
    {
      timestamp: '2026-05-12T18:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Local shell command completed.' }]
      }
    }
  ].map(line => JSON.stringify(line)).join('\n');
}

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

    // Should show tool use formatting (fixture has tool calls)
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
    const toolIndex = markdown.indexOf('**Tool Use:**');

    expect(userIndex).toBeGreaterThan(-1);
    expect(assistantIndex).toBeGreaterThan(-1);
    expect(toolIndex).toBeGreaterThan(-1);
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

  it('should format Codex rollout JSONL', () => {
    const markdown = formatConversationAsMarkdown(codexJsonl());

    expect(markdown).toContain('**Harness:** Codex');
    expect(markdown).toContain('019e4c75-d5bf-7c71-9df7-77f5fb86b711');
    expect(markdown).toContain('**Model:** gpt-5.2');
    expect(markdown).toContain('Please inspect the config loader.');
    expect(markdown).toContain('**Tool Use:** `exec_command`');
    expect(markdown).toContain('**Result:**');
    expect(markdown).toContain('export function loadConfig() {}');
    expect(markdown).toContain('The config loader reads the default profile first.');
  });

  it('should include Codex local shell outputs in markdown', () => {
    const markdown = formatConversationAsMarkdown(codexJsonlWithLocalShellOutput());

    expect(markdown).toContain('**Tool Use:** `local_shell_call`');
    expect(markdown).toContain('**Result:**');
    expect(markdown).toContain('Exit code: 0');
    expect(markdown).toContain('local shell');
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

    // Check for tool call formatting (fixture has tool calls)
    expect(html).toContain('Tool Use');
  });

  it('should include session metadata', () => {
    const jsonl = readFileSync(join(fixturesDir, 'tiny-conversation.jsonl'), 'utf-8');
    const html = formatConversationAsHTML(jsonl);

    expect(html).toContain('67a8478e-78dc-44ab-82ea-f65c8ead85f6');
    expect(html).toContain('streaming');
  });

  it('should format Codex rollout JSONL as HTML', () => {
    const html = formatConversationAsHTML(codexJsonl());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Codex');
    expect(html).toContain('Please inspect the config loader.');
    expect(html).toContain('Tool Use');
    expect(html).toContain('exec_command');
    expect(html).toContain('The config loader reads the default profile first.');
  });

  it('should include Codex local shell outputs in HTML', () => {
    const html = formatConversationAsHTML(codexJsonlWithLocalShellOutput());

    expect(html).toContain('Tool Use');
    expect(html).toContain('local_shell_call');
    expect(html).toContain('Exit code: 0');
    expect(html).toContain('local shell');
  });

  it('escapes raw HTML from Codex messages and tool results', () => {
    const html = formatConversationAsHTML(codexJsonlWithRawHtml());

    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<\/script>/i);
    expect(html).not.toContain('<b>literal markup</b>');
    expect(html).toContain('&lt;script&gt;alert(');
    expect(html).toContain('&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;literal markup&lt;/b&gt;');
  });
});
