import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('Windows child launch options', () => {
  it('keeps Codex version, app-server, and background sync children hidden in source and build output', () => {
    const result = spawnSync(process.execPath, [join(root, 'test/windows-hidden-spawn.cjs'), root], {
      cwd: root, encoding: 'utf8', timeout: 20_000, windowsHide: true,
    });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(6);
    expect(report.realChildrenLaunched).toBe(0);
  });

  it.each([
    ['command', 'cli/episodic-memory.js'],
    ['mcp', 'cli/mcp-server-wrapper.js'],
  ])('keeps the %s CLI child hidden while preserving inherited IO', (mode, relativePath) => {
    const target = join(root, relativePath);
    const hostileRoot = mkdtempSync(join(tmpdir(), 'episodic-hostile-parent-'));
    const sentinel = join(hostileRoot, 'sentinel');
    writeFileSync(sentinel, 'unchanged');
    try {
      const result = spawnSync(process.execPath, [join(root, 'test/cli-hidden-spawn-fixture.cjs'), target, mode], {
        cwd: root, encoding: 'utf8', timeout: 10_000, windowsHide: true,
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: hostileRoot },
      });
      expect(result.status, result.stderr).toBe(0);
      const calls = result.stdout.split(/\r?\n/).filter(line => line.startsWith('SPAWN_OPTIONS='));
      expect(calls).toHaveLength(1);
      const call = JSON.parse(calls[0].slice('SPAWN_OPTIONS='.length));
      expect(call.command).toBe(process.execPath);
      expect(call.options.windowsHide).toBe(true);
      expect(call.options.stdio).toBe('inherit');
      if (mode === 'mcp') expect(call.options.shell).toBe(false);
      expect(existsSync(join(hostileRoot, 'node_modules'))).toBe(false);
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(hostileRoot, { recursive: true, force: true });
    }
  });
});
