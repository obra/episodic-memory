import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(import.meta.dirname, '..');

function read(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf-8');
}

function frontmatterDescription(markdown: string): string {
  const match = markdown.match(/^---\n[\s\S]*?^description:\s*(.+)$/m);

  if (!match) {
    throw new Error('Missing frontmatter description');
  }

  return match[1];
}

function expectBroadRecallTrigger(description: string): void {
  const lower = description.toLowerCase();

  expect(lower).toMatch(/recall|learned|past|prior|previous|history/);
  expect(lower).toMatch(/conversation|experience/);
  expect(lower).toMatch(/decision|pattern|solution|pitfall|workflow|lesson|context/);
  expect(lower).not.toMatch(/favorite color|personal facts|user-related fact|user asks/);
}

describe('Codex-aware skills', () => {
  it('documents both Claude Code and Codex invocation paths in the skill', () => {
    const skill = read('skills/remembering-conversations/SKILL.md');

    expect(skill).toContain('Claude Code');
    expect(skill).toContain('Codex');
    expect(skill).toContain('Task tool');
    expect(skill).toContain('MCP tools directly');
  });

  it('describes episodic memory as cross-harness instead of Claude-only', () => {
    expect(read('skills/remembering-conversations/MCP-TOOLS.md'))
      .toContain('Claude Code and Codex conversations');
    expect(read('agents/search-conversations.md'))
      .toContain('Claude Code and Codex conversations');
    expect(read('prompts/search-agent.md'))
      .toContain('Claude Code and Codex conversations');
    expect(read('src/mcp-server.ts'))
      .toContain('Claude Code and Codex conversations');
    expect(read('README.md'))
      .toContain('Codex plugin');
    expect(read('README.md'))
      .toContain('~/.codex/sessions');
  });

  it('triggers whenever recall from past conversations or experience is needed', () => {
    const skill = read('skills/remembering-conversations/SKILL.md');
    const description = frontmatterDescription(skill);
    const commandDescription = frontmatterDescription(read('commands/search-conversations.md'));
    const agentDescription = frontmatterDescription(read('agents/search-conversations.md'));

    expectBroadRecallTrigger(description);
    expectBroadRecallTrigger(commandDescription);
    expectBroadRecallTrigger(agentDescription);
    expect(skill).toMatch(/not explicitly ask/i);
    expect(skill).toMatch(/guessing from memory/i);
  });
});
