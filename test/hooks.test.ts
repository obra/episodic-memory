import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('plugin hook configuration', () => {
  it('quotes CLAUDE_PLUGIN_ROOT in the SessionStart command', () => {
    const hooks = JSON.parse(
      readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf-8')
    );

    const command = hooks.hooks.SessionStart[0].hooks[0].command;

    expect(command).toBe('node "${CLAUDE_PLUGIN_ROOT}/cli/episodic-memory.js" sync --background');
  });
});
