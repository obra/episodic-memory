import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('test configuration isolation cleanup', () => {
  it.each([false, true])('removes its own state after a run (failure: %s)', (fail) => {
    const root = mkdtempSync(join(tmpdir(), 'episodic-setup-cleanup-'));
    fixtureRoots.push(root);
    const temporary = join(root, 'temporary');
    const sibling = join(temporary, 'unrelated');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'keep.txt'), 'preserved');

    writeFileSync(join(root, 'vitest.config.mjs'), `export default ${JSON.stringify({
      test: {
        include: ['fixture.test.mjs'],
        setupFiles: [join(repoRoot, 'test/setup-isolated-config.ts')],
      },
    })};`);
    writeFileSync(join(root, 'fixture.test.mjs'), `
      import { it, expect } from ${JSON.stringify(join(repoRoot, 'node_modules/vitest/dist/index.js'))};
      import { mkdirSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      it('writes only isolated synthetic state', () => {
        const config = process.env.EPISODIC_MEMORY_CONFIG_DIR;
        expect(config.startsWith(${JSON.stringify(temporary)})).toBe(true);
        mkdirSync(config, { recursive: true });
        writeFileSync(join(config, 'synthetic-state.txt'), 'fixture');
        expect(${fail}).toBe(false);
      });
    `);

    const result = spawnSync(process.execPath, [
      join(repoRoot, 'node_modules/vitest/vitest.mjs'), 'run',
      '--root', root, '--config', join(root, 'vitest.config.mjs'),
      '--maxWorkers=1', '--minWorkers=1',
    ], {
      cwd: root,
      env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
      timeout: 15000,
      encoding: 'utf-8',
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(fail ? 1 : 0);
    expect(readdirSync(temporary).filter(name => name.startsWith('episodic-memory-vitest-'))).toEqual([]);
    expect(readFileSync(join(sibling, 'keep.txt'), 'utf-8')).toBe('preserved');
  });
});
