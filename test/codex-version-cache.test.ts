import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const observed = vi.hoisted(() => ({ calls: [] as any[], closed: [] as Promise<unknown>[] }));
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    observed.calls.push(args);
    const child = actual.spawn(...args);
    observed.closed.push(new Promise(resolve => child.once('close', resolve)));
    return child;
  } };
});
import { runCodexCommand } from '../src/summarizer.js';
import { resolveCodexExecutable } from '../src/codex-executable.js';
import * as executableResolver from '../src/codex-executable.js';

const fixture = fileURLToPath(new URL('./fixtures/codex-cache-server.cjs', import.meta.url));
const dirs: string[] = [];
function temp() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cache-')); dirs.push(dir); return dir; }
function request(versionArgs = ['--version'], command = process.execPath) {
  return { command, args: [fixture], versionArgs, sessionId: 'synthetic-session', prompt: 'synthetic prompt' };
}
function checks() { return observed.calls.filter(call => call[1][0] !== fixture); }
async function settle() { await Promise.all(observed.closed); }
afterEach(async () => {
  await settle();
  observed.calls.length = 0; observed.closed.length = 0;
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('worker-local Codex compatibility cache', () => {
  it('launches one version check and ten independent ephemeral app-servers for a serial batch', async () => {
    const req = request(['-e', "console.log('codex-cli 0.150.0') // serial"]);
    for (let i = 0; i < 10; i++) expect(await runCodexCommand(req)).toBe('synthetic summary');
    expect(checks()).toHaveLength(1);
    expect(observed.calls).toHaveLength(11);
    for (const call of observed.calls) {
      expect(call[2].windowsHide).toBe(true);
      expect(call[2].env.EPISODIC_MEMORY_SUMMARIZER_GUARD).toBe('1');
    }
  });
  it('coalesces concurrent version requests while keeping every app-server independent', async () => {
    const req = request(['-e', "setTimeout(() => console.log('codex-cli 0.150.0'), 80) // concurrent"]);
    expect(await Promise.all(Array.from({ length: 8 }, () => runCodexCommand(req)))).toHaveLength(8);
    expect(checks()).toHaveLength(1);
    expect(observed.calls).toHaveLength(9);
  });
  it('does not cache unsupported, malformed, or failed validations', async () => {
    for (const code of ["console.log('codex-cli 0.129.0')", "console.log('unparseable')", 'process.exit(2)']) {
      const req = request(['-e', code]);
      for (let i = 0; i < 2; i++) await expect(runCodexCommand(req)).rejects.toThrow();
    }
    expect(checks()).toHaveLength(6);
    expect(observed.calls).toHaveLength(6);
  });
  it('coalesces a failed wave and retries successfully with identical arguments', async () => {
    const flag = path.join(temp(), 'retry-flag');
    const code = `const fs=require('fs'); if(fs.existsSync(${JSON.stringify(flag)})) console.log('codex-cli 0.150.0'); else process.exit(2);`;
    const req = request(['-e', code]);
    const failed = await Promise.allSettled([runCodexCommand(req), runCodexCommand(req)]);
    expect(failed.every(result => result.status === 'rejected')).toBe(true);
    expect(checks()).toHaveLength(1);
    fs.writeFileSync(flag, 'retry');
    await runCodexCommand(req);
    await runCodexCommand(req);
    expect(checks()).toHaveLength(2);
    expect(observed.calls).toHaveLength(4);
  });
  it('preserves skipVersionCheck without poisoning later checks', async () => {
    const req = request(['-e', "console.log('codex-cli 0.129.1')"]);
    await runCodexCommand({ ...req, skipVersionCheck: true });
    expect(checks()).toHaveLength(0);
    await expect(runCodexCommand(req)).rejects.toThrow(/0.129.1/);
    expect(checks()).toHaveLength(1);
  });
  it('invalidates after same-path executable replacement, including restored size/mtime', async () => {
    const executable = path.join(temp(), process.platform === 'win32' ? 'fixture.exe' : 'fixture');
    fs.copyFileSync(process.execPath, executable);
    fs.chmodSync(executable, 0o755);
    fs.utimesSync(executable, new Date(), new Date());
    const req = request(['-e', "console.log('codex-cli 0.150.0') // replacement"], executable);
    await runCodexCommand(req);
    await settle();
    const coldChecks = checks().length;
    expect(coldChecks).toBeLessThanOrEqual(2);
    await runCodexCommand(req);
    await settle();
    expect(checks()).toHaveLength(coldChecks);
    const before = fs.statSync(executable);
    fs.renameSync(executable, `${executable}.old`);
    fs.copyFileSync(process.execPath, executable);
    fs.chmodSync(executable, 0o755);
    fs.utimesSync(executable, before.atime, before.mtime);
    await runCodexCommand(req);
    expect(checks().length).toBeGreaterThan(coldChecks);
  });
  it('resolves PATH changes and relative commands against the current directory', async () => {
    const a = temp(), b = temp();
    const name = process.platform === 'win32' ? 'synthetic-codex.exe' : 'synthetic-codex';
    for (const dir of [a, b]) {
      fs.copyFileSync(process.execPath, path.join(dir, name));
      fs.chmodSync(path.join(dir, name), 0o755);
      fs.utimesSync(path.join(dir, name), new Date(), new Date());
    }
    // Use the existing canonical key so Windows duplicate-key ordering is preserved.
    const key = Object.keys(process.env).sort().find(k => k.toLowerCase() === 'path') ?? 'PATH';
    vi.stubEnv(key, a);
    await runCodexCommand(request(['-e', "console.log('codex-cli 0.150.0') // path"], 'synthetic-codex'));
    vi.stubEnv(key, b);
    await runCodexCommand(request(['-e', "console.log('codex-cli 0.150.0') // path"], 'synthetic-codex'));
    expect(checks()[0][0]).toBe('synthetic-codex');
    expect(checks().at(-1)[0]).toBe('synthetic-codex');
    const cwd = process.cwd();
    try {
      process.chdir(a);
      expect(resolveCodexExecutable(`./${name}`)?.command).toBe(fs.realpathSync(path.join(a, name)));
      process.chdir(b);
      expect(resolveCodexExecutable(`./${name}`)?.command).toBe(fs.realpathSync(path.join(b, name)));
    } finally { process.chdir(cwd); }
  });
  it('leaves opaque scripts and missing commands uncached', () => {
    const script = path.join(temp(), 'wrapper');
    fs.writeFileSync(script, '#!/bin/sh\nexec codex "$@"\n');
    fs.chmodSync(script, 0o755);
    expect(resolveCodexExecutable(script)).toBeUndefined();
    expect(resolveCodexExecutable(`${script}-missing`)).toBeUndefined();
  });
  it('invalidates a retargeted directory alias and in-place metadata changes', () => {
    const root = temp();
    const a = path.join(root, 'a'), b = path.join(root, 'b');
    fs.mkdirSync(a); fs.mkdirSync(b);
    const name = path.basename(process.execPath);
    fs.copyFileSync(process.execPath, path.join(a, name));
    fs.copyFileSync(process.execPath, path.join(b, name));
    fs.chmodSync(path.join(a, name), 0o755);
    fs.chmodSync(path.join(b, name), 0o755);
    const alias = path.join(root, 'current');
    fs.symlinkSync(a, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const first = resolveCodexExecutable(path.join(alias, name));
    fs.unlinkSync(alias);
    fs.symlinkSync(b, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const second = resolveCodexExecutable(path.join(alias, name));
    expect(first?.command).toBe(fs.realpathSync(path.join(a, name)));
    expect(second?.command).toBe(fs.realpathSync(path.join(b, name)));
    expect(first?.identity).not.toBe(second?.identity);
    const copy = path.join(root, name);
    fs.copyFileSync(process.execPath, copy);
    fs.chmodSync(copy, 0o755);
    const before = resolveCodexExecutable(copy)?.identity;
    fs.utimesSync(copy, new Date(), new Date(Date.now() + 5000));
    expect(resolveCodexExecutable(copy)?.identity).not.toBe(before);
  });
  it('preserves the caller native alias and argv0 for version and app-server launches', async () => {
    const dir = temp();
    const alias = path.join(dir, 'node-alias');
    fs.symlinkSync(path.dirname(process.execPath), alias, process.platform === 'win32' ? 'junction' : 'dir');
    const command = path.join(alias, path.basename(process.execPath));
    vi.stubEnv('SYNTHETIC_EXPECT_ARGV0', command);
    const code = `if(process.argv0 !== ${JSON.stringify(command)}) throw Error('changed argv0'); console.log('codex-cli 0.150.0');`;
    expect(await runCodexCommand(request(['-e', code], command))).toBe('synthetic summary');
    expect(observed.calls.every(call => call[0] === command)).toBe(true);
    expect(resolveCodexExecutable(command)?.command).toBe(fs.realpathSync(process.execPath));
  });
  it.skipIf(process.platform !== 'win32')('matches native Windows extension fallback and leaves ambiguous search uncached', async () => {
    const dir = temp();
    const file = path.join(dir, 'synthetic-codex.custom.exe');
    fs.copyFileSync(process.execPath, file);
    const key = Object.keys(process.env).sort().find(k => k.toLowerCase() === 'path') ?? 'PATH';
    vi.stubEnv(key, dir);
    for (const policyKey of Object.keys(process.env).filter(k => k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath')) vi.stubEnv(policyKey, undefined);
    expect(resolveCodexExecutable('synthetic-codex.custom')?.command).toBe(fs.realpathSync(file));
    const { spawnSync } = await import('child_process');
    const actual = spawnSync('synthetic-codex.custom', ['-e', 'console.log(process.execPath)'], { windowsHide: true, encoding: 'utf8' });
    expect(actual.status).toBe(0);
    expect(fs.realpathSync(actual.stdout.trim())).toBe(fs.realpathSync(file));
    vi.stubEnv('NoDefaultCurrentDirectoryInExePath', '1');
    expect(resolveCodexExecutable('synthetic-codex.custom')).toBeUndefined();
    expect(resolveCodexExecutable('C:codex.exe')).toBeUndefined();
  });
  it('coalesces the bounded identity retry and rejects repeated instability', async () => {
    let resolution = 0;
    const spy = vi.spyOn(executableResolver, 'resolveCodexExecutable').mockImplementation(() => ({ command: 'synthetic-binary', identity: ++resolution === 1 ? 'old' : 'new' }));
    try {
      const req = request(['-e', "setTimeout(() => console.log('codex-cli 0.150.0'), 60) // identity retry"]);
      await Promise.all([runCodexCommand(req), runCodexCommand(req)]);
      expect(checks()).toHaveLength(2);
      expect(observed.calls).toHaveLength(4);
      await runCodexCommand(req);
      expect(checks()).toHaveLength(2);
      spy.mockImplementation(() => ({ command: 'unstable-binary', identity: String(++resolution) }));
      const start = checks().length;
      await expect(runCodexCommand(request(['-e', "console.log('codex-cli 0.150.0') // unstable"]))).rejects.toThrow('changed during compatibility');
      expect(checks()).toHaveLength(start + 2);
    } finally { spy.mockRestore(); }
  });
  it('rejects an unsupported replacement during retry before any app-server starts', async () => {
    let resolution = 0;
    const spy = vi.spyOn(executableResolver, 'resolveCodexExecutable').mockImplementation(() => ({ command: 'replacement-binary', identity: ++resolution === 1 ? 'old' : 'new' }));
    const marker = path.join(temp(), 'version-replaced');
    const code = `const fs=require('fs'); const p=${JSON.stringify(marker)}; if(fs.existsSync(p)) console.log('codex-cli 0.129.0'); else {fs.writeFileSync(p,'changed'); console.log('codex-cli 0.150.0');}`;
    try {
      await expect(runCodexCommand(request(['-e', code]))).rejects.toThrow('found 0.129.0');
      expect(checks()).toHaveLength(2);
      expect(observed.calls).toHaveLength(2);
    } finally { spy.mockRestore(); }
  });
});
