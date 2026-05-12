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
});
