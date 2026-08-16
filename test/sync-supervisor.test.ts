import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runSyncSupervisor } from '../src/sync-supervisor.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workerFixture(delayMs = 250): { dir: string; script: string; count: string } {
  const dir = mkdtempSync(join(tmpdir(), 'episodic-supervisor-test-'));
  dirs.push(dir);
  const script = join(dir, 'worker.mjs');
  const count = join(dir, 'invocations');
  writeFileSync(script, `
import fs from 'fs';
if (!process.send || !process.connected) process.exit(41);
const token = process.env.EPISODIC_MEMORY_WRITER_TOKEN;
process.send({ type: 'challenge', token });
process.on('message', message => {
  if (message?.type !== 'authorized' || message.token !== token) process.exit(42);
  fs.appendFileSync(process.env.INVOCATIONS, '1\\n');
  setTimeout(() => process.exit(0), Number(process.env.DELAY_MS));
});
`);
  return { dir, script, count };
}

describe('sync lock supervisor', () => {
  it('eight contenders start one worker and seven clean skips', async () => {
    const f = workerFixture();
    const lockPath = join(f.dir, 'sync.lock');
    const results = await Promise.all(Array.from({ length: 8 }, () => runSyncSupervisor({
      lockPath,
      workerScript: f.script,
      workerEnv: { INVOCATIONS: f.count, DELAY_MS: '250' },
    })));
    expect(results.filter(result => result.kind === 'completed')).toHaveLength(1);
    expect(results.filter(result => result.kind === 'skipped')).toHaveLength(7);
    expect(readFileSync(f.count, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('keeps the lock heartbeat alive while the worker is blocked', async () => {
    const f = workerFixture(2600);
    const lockPath = join(f.dir, 'sync.lock');
    const running = runSyncSupervisor({
      lockPath,
      workerScript: f.script,
      workerEnv: { INVOCATIONS: f.count, DELAY_MS: '2600' },
      lockOptions: { staleMs: 2000, updateMs: 500 },
    });
    while (!existsSync(`${lockPath}.lock`)) await new Promise(resolve => setTimeout(resolve, 20));
    const first = statSync(`${lockPath}.lock`).mtimeMs;
    await new Promise(resolve => setTimeout(resolve, 1200));
    const second = statSync(`${lockPath}.lock`).mtimeMs;
    expect(second).toBeGreaterThan(first);
    expect((await running).kind).toBe('completed');
  });

  it('rejects a worker that cannot complete the IPC challenge', async () => {
    const f = workerFixture();
    const bad = join(f.dir, 'bad-worker.mjs');
    writeFileSync(bad, 'process.exit(0);');
    await expect(runSyncSupervisor({ lockPath: join(f.dir, 'bad.lock'), workerScript: bad })).rejects.toThrow(/handshake/i);
  });

  it('holds the lock until a timed-out worker has actually exited', async () => {
    const f = workerFixture();
    const stubborn = join(f.dir, 'stubborn.mjs');
    writeFileSync(stubborn, `
if (!process.send) process.exit(41);
const token=process.env.EPISODIC_MEMORY_WRITER_TOKEN;
process.send({type:'challenge',token});
process.on('message', m => { if (m?.type === 'authorized') process.on('SIGTERM', () => {}); });
`);
    const lockPath = join(f.dir, 'timeout.lock');
    const first = runSyncSupervisor({ lockPath, workerScript: stubborn, workerTimeoutMs: 50, terminationGraceMs: 300 })
      .then(() => null, error => error as Error);
    await new Promise(resolve => setTimeout(resolve, 120));
    const contender = await runSyncSupervisor({ lockPath, workerScript: f.script, workerEnv: { INVOCATIONS: f.count, DELAY_MS: '10' } });
    expect(contender.kind).toBe('skipped');
    expect((await first)?.message).toMatch(/timed out/);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('terminates the worker when the lock heartbeat is compromised', async () => {
    const f = workerFixture(5000); const lockPath = join(f.dir, 'compromised.lock');
    const running = runSyncSupervisor({ lockPath, workerScript: f.script,
      workerEnv: { INVOCATIONS: f.count, DELAY_MS: '5000' }, lockOptions: { staleMs: 2000, updateMs: 500 } });
    while (!existsSync(f.count) || !existsSync(`${lockPath}.lock`)) await new Promise(resolve => setTimeout(resolve, 20));
    rmSync(`${lockPath}.lock`, { recursive: true, force: true });
    await expect(running).rejects.toThrow(/heartbeat compromised/);
    expect(existsSync(lockPath)).toBe(false);
  });
});
