import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { RcloneTransport, RunBudget, checkCacheCapacity } from '../src/rclone-transport.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(): { dir: string; script: string; remoteDir: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'episodic-rclone-test-'));
  dirs.push(dir);
  const script = join(dir, 'fake-rclone.mjs');
  const remoteDir = join(dir, 'remote');
  const log = join(dir, 'calls.jsonl');
  writeFileSync(script, `#!${process.execPath}
import fs from 'fs'; import path from 'path';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_RCLONE_LOG, JSON.stringify(args) + '\\n');
if (process.env.FAKE_DELAY_MS) await new Promise(resolve => setTimeout(resolve, Number(process.env.FAKE_DELAY_MS)));
const map = value => path.join(process.env.FAKE_REMOTE_DIR, value.replace(/^[^:]+:/, ''));
if (args[0] === 'copyto') {
  const [src,dst] = args.slice(1);
  if (dst.includes(':')) { fs.mkdirSync(path.dirname(map(dst)), {recursive:true}); fs.copyFileSync(src,map(dst)); }
  else { fs.mkdirSync(path.dirname(dst), {recursive:true}); fs.copyFileSync(map(src),dst); }
} else if (args[0] === 'cat') {
  process.stdout.write(fs.readFileSync(map(args[1])));
} else process.exit(9);
`);
  chmodSync(script, 0o755);
  return { dir, script, remoteDir, log };
}

describe('rclone archive transport contract', () => {
  it('uploads with copyto then streams exact remote bytes for SHA-256 proof', async () => {
    const f = fixture();
    const local = join(f.dir, 'source.jsonl');
    writeFileSync(local, 'one\ntwo\n');
    const transport = new RcloneTransport({
      executable: f.script,
      env: { PATH: '/poisoned', FAKE_REMOTE_DIR: f.remoteDir, FAKE_RCLONE_LOG: f.log },
    });

    const proof = await transport.uploadVerified(local, 'testremote:archive/project/source.jsonl');
    expect(proof.bytes).toBe(8);
    expect(proof.sha256).toBe(createHash('sha256').update('one\ntwo\n').digest('hex'));
    expect(readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse)).toEqual([
      ['copyto', local, 'testremote:archive/project/source.jsonl'],
      ['cat', 'testremote:archive/project/source.jsonl'],
    ]);
  });

  it('fails closed when streamed remote bytes do not match the staged object', async () => {
    const f = fixture();
    const local = join(f.dir, 'source.jsonl');
    writeFileSync(local, 'expected');
    const transport = new RcloneTransport({ executable: f.script, env: { FAKE_REMOTE_DIR: f.remoteDir, FAKE_RCLONE_LOG: f.log } });
    await transport.copyTo(local, 'testremote:archive/source.jsonl');
    writeFileSync(join(f.remoteDir, 'archive/source.jsonl'), 'tampered');
    await expect(transport.verifyRemote(local, 'testremote:archive/source.jsonl')).rejects.toThrow(/integrity/i);
  });

  it('bounds a stalled rclone subprocess', async () => {
    const f = fixture(); const local = join(f.dir, 'source.jsonl'); writeFileSync(local, 'x');
    const transport = new RcloneTransport({ executable: f.script, timeoutMs: 20,
      env: { FAKE_REMOTE_DIR: f.remoteDir, FAKE_RCLONE_LOG: f.log, FAKE_DELAY_MS: '5000' } });
    await expect(transport.uploadVerified(local, 'remote:archive/x.jsonl')).rejects.toThrow(/failed/i);
  });

  it('enforces next-file run bounds before staging', () => {
    const budget = new RunBudget({ startedAtMs: 0 });
    expect(budget.canStart(1024, 1)).toEqual({ allowed: true });
    budget.record(1024);
    budget.files = 200;
    expect(budget.canStart(1, 2).allowed).toBe(false);
    budget.files = 0;
    budget.bytes = 1024 ** 3;
    expect(budget.canStart(1, 2).allowed).toBe(false);
    budget.bytes = 0;
    expect(budget.canStart(1, 15 * 60 * 1000).allowed).toBe(false);
  });

  it('enforces the 4 GiB cache and 8 GiB unrelated-free reserve', () => {
    expect(checkCacheCapacity(3 * 1024 ** 3, 1024 ** 3, 9 * 1024 ** 3).allowed).toBe(true);
    expect(checkCacheCapacity(3 * 1024 ** 3, 1024 ** 3 + 1, 20 * 1024 ** 3).allowed).toBe(false);
    expect(checkCacheCapacity(0, 2 * 1024 ** 3, 9 * 1024 ** 3).allowed).toBe(false);
  });
});
