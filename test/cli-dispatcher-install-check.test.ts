import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, chmodSync, readFileSync } from 'fs';
import { spawn as spawnProcess } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DISPATCHER_PATH = join(REPO_ROOT, 'cli', 'episodic-memory.js');

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!condition()) {
    throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
  }
}

describe('cli/episodic-memory.js dispatcher — dependency self-heal', () => {
  let root: string;
  let binDir: string;

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
    try { rmSync(binDir, { recursive: true, force: true }); } catch {}
  });

  it('runs npm install when node_modules is missing, before dispatching a subcommand', async () => {
    // Regression test for the gap where mcp-server-wrapper.js self-healed a
    // missing node_modules but the CLI dispatcher (invoked directly by the
    // SessionStart `sync` hook) had no such probe and crashed with
    // ERR_MODULE_NOT_FOUND instead.
    root = mkdtempSync(join(tmpdir(), 'episodic-memory-cli-root-'));
    binDir = mkdtempSync(join(tmpdir(), 'episodic-memory-cli-bin-'));

    const pidFile = join(root, 'npm-stub.pid');
    const npmStubPath = join(binDir, 'npm');
    writeFileSync(
      npmStubPath,
      `#!/usr/bin/env node\n` +
        `import { writeFileSync } from 'fs';\n` +
        `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
        `setInterval(() => {}, 1000);\n`,
      'utf-8'
    );
    chmodSync(npmStubPath, 0o755);

    // An empty plugin root: node_modules is entirely absent, so the
    // dispatcher's findMissingDeps probe reports everything missing and
    // takes the install path, invoking our stub "npm" (resolved via PATH).
    const child = spawnProcess(process.execPath, [DISPATCHER_PATH, 'stats'], {
      cwd: root,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: root,
        PATH: `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      await waitFor(() => existsSync(pidFile), 10_000);
      const stubPid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      expect(Number.isFinite(stubPid)).toBe(true);
    } finally {
      try { child.kill('SIGKILL'); } catch {}
    }
  }, 20_000);

  it('does not attempt an install for --help', async () => {
    root = mkdtempSync(join(tmpdir(), 'episodic-memory-cli-root-'));
    binDir = mkdtempSync(join(tmpdir(), 'episodic-memory-cli-bin-'));

    const pidFile = join(root, 'npm-stub.pid');
    const npmStubPath = join(binDir, 'npm');
    writeFileSync(
      npmStubPath,
      `#!/usr/bin/env node\n` +
        `import { writeFileSync } from 'fs';\n` +
        `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
        `process.exit(0);\n`,
      'utf-8'
    );
    chmodSync(npmStubPath, 0o755);

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawnProcess(process.execPath, [DISPATCHER_PATH, '--help'], {
        cwd: root,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: root,
          PATH: `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}`))));
      child.on('error', reject);
    });

    expect(output).toContain('USAGE:');
    expect(existsSync(pidFile)).toBe(false);
  }, 20_000);
});
