import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import plugin, { server } from '../src/opencode-plugin.js';

const REPO_ROOT = join(import.meta.dirname, '..');

function readJson(relPath: string): any {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), 'utf-8'));
}

function createShellRecorder() {
  const commands: string[] = [];
  const shell = ((strings: TemplateStringsArray, ...expressions: unknown[]) => {
    let command = '';
    strings.forEach((part, index) => {
      command += part;
      if (index < expressions.length) command += String(expressions[index]);
    });
    commands.push(command.trim().replace(/\s+/g, ' '));
    const promise = Promise.resolve({
      exitCode: 0,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      text: () => '',
    }) as any;
    promise.quiet = () => promise;
    promise.nothrow = () => promise;
    return promise;
  }) as any;
  return { shell, commands };
}

describe('opencode plugin packaging', () => {
  it('exports a v1 opencode server plugin as the default export', () => {
    expect(plugin).toMatchObject({
      id: 'episodic-memory',
      server,
    });
  });

  it('runs opencode-only background sync when a session becomes idle', async () => {
    const { shell, commands } = createShellRecorder();
    const hooks = await server({ $, client: undefined } as any, { summaryLimit: 3 });

    await hooks.event?.({ event: { type: 'session.idle' } as any });
    await hooks.event?.({ event: { type: 'session.updated' } as any });

    expect(commands).toEqual([
      'episodic-memory sync --background --only opencode --summary-limit 3',
    ]);

    function $() {
      return shell.apply(null, arguments as any);
    }
  });

  it('declares an opencode server export in package metadata', () => {
    const pkg = readJson('package.json');

    expect(pkg.exports['./server']).toBeDefined();
    expect(pkg.exports['./server'].import).toBe('./dist/opencode-plugin.js');
  });

  it('builds an opencode documentation page', () => {
    expect(existsSync(join(REPO_ROOT, 'docs/OPENCODE.md'))).toBe(true);
  });
});
