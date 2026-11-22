import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = join(import.meta.dirname, '..');

describe('postinstall native-stack verification', () => {
  let testDir: string | undefined;

  afterEach(() => {
    if (testDir) rmSync(testDir, { recursive: true, force: true });
  });

  it('reports an ABI mismatch without attempting a source rebuild', () => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-postinstall-'));
    const scriptsDir = join(testDir, 'scripts');
    const packageDir = join(testDir, 'node_modules', 'better-sqlite3');
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(packageDir, { recursive: true });
    copyFileSync(join(REPO_ROOT, 'scripts', 'postinstall.js'), join(scriptsDir, 'postinstall.js'));
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: 'better-sqlite3', version: '13.0.3', main: 'index.js' })
    );
    writeFileSync(
      join(packageDir, 'index.js'),
      `module.exports = class Database {
        constructor() {
          throw new Error('compiled using NODE_MODULE_VERSION 147; this Node requires NODE_MODULE_VERSION 137');
        }
      };`
    );

    const result = spawnSync(process.execPath, [join(scriptsDir, 'postinstall.js')], {
      encoding: 'utf-8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NATIVE BINDING IS BROKEN');
    expect(result.stderr).toContain('binary built for : NODE_MODULE_VERSION 147');
    expect(result.stderr).not.toContain('TypeError');
    expect(result.stderr).not.toContain('build-release');
  });
});
