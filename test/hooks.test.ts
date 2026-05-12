import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('plugin hook configuration', () => {
  it('uses a plugin root fallback that works in Codex and Claude Code', () => {
    const hooks = JSON.parse(
      readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf-8')
    );

    const command = hooks.hooks.SessionStart[0].hooks[0].command;

    expect(command).toBe('node "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/cli/episodic-memory.js" sync --background');
  });

  it('does not mark the hook async because Codex plugin hooks do not support async handlers yet', () => {
    const hooks = JSON.parse(
      readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf-8')
    );

    const handler = hooks.hooks.SessionStart[0].hooks[0];

    expect(handler.async).toBeUndefined();
  });
});
