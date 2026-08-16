import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export const CACHE_LIMIT_BYTES = 4 * 1024 ** 3;
export const FREE_RESERVE_BYTES = 8 * 1024 ** 3;
export const RUN_LIMIT_BYTES = 1024 ** 3;
export const RUN_LIMIT_FILES = 200;
export const RUN_LIMIT_MS = 15 * 60 * 1000;

export interface CapacityResult { allowed: boolean; reason?: string }

export function checkCacheCapacity(cacheBytes: number, nextBytes: number, freeBytes: number): CapacityResult {
  if (cacheBytes + nextBytes > CACHE_LIMIT_BYTES) return { allowed: false, reason: '4 GiB cache limit' };
  if (freeBytes - nextBytes < FREE_RESERVE_BYTES) return { allowed: false, reason: '8 GiB free-space reserve' };
  return { allowed: true };
}

export class RunBudget {
  readonly startedAtMs: number;
  bytes = 0;
  files = 0;

  constructor(options: { startedAtMs?: number } = {}) {
    this.startedAtMs = options.startedAtMs ?? Date.now();
  }

  canStart(nextBytes: number, nowMs = Date.now()): CapacityResult {
    if (nextBytes < 0) return { allowed: false, reason: 'invalid negative size' };
    if (this.files >= RUN_LIMIT_FILES) return { allowed: false, reason: '200-file run limit' };
    if (this.bytes + nextBytes > RUN_LIMIT_BYTES) return { allowed: false, reason: '1 GiB run limit' };
    if (nowMs - this.startedAtMs >= RUN_LIMIT_MS) return { allowed: false, reason: '15-minute run limit' };
    return { allowed: true };
  }

  record(bytes: number): void {
    this.bytes += bytes;
    this.files += 1;
  }
}

export interface ObjectProof { bytes: number; sha256: string }

interface RcloneOptions {
  executable?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class RcloneTransport {
  private readonly executable: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;

  constructor(options: RcloneOptions = {}) {
    this.executable = options.executable ?? process.env.EPISODIC_MEMORY_RCLONE_EXECUTABLE ?? 'rclone';
    this.env = { ...process.env, ...options.env };
    this.timeoutMs = options.timeoutMs ?? RUN_LIMIT_MS;
  }

  async copyTo(source: string, destination: string): Promise<void> {
    await this.run(['copyto', source, destination]);
  }

  async verifyRemote(localPath: string, remoteKey: string): Promise<ObjectProof> {
    const expected = await hashFile(localPath);
    const actual = await this.streamHash(['cat', remoteKey]);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(`Remote integrity mismatch for ${remoteKey}`);
    }
    return actual;
  }

  async uploadVerified(localPath: string, remoteKey: string): Promise<ObjectProof> {
    if (!remoteKey || !remoteKey.includes(':')) throw new Error('Remote key must include an rclone remote');
    await this.copyTo(localPath, remoteKey);
    return this.verifyRemote(localPath, remoteKey);
  }

  async downloadVerified(remoteKey: string, localPath: string, expected: ObjectProof): Promise<void> {
    const partial = `${localPath}.partial.${process.pid}.${randomUUID()}`;
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    try {
      await this.copyTo(remoteKey, partial);
      const actual = await hashFile(partial);
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
        throw new Error(`Downloaded transcript integrity mismatch for ${remoteKey}`);
      }
      fs.renameSync(partial, localPath);
    } finally {
      try { fs.unlinkSync(partial); } catch {}
    }
  }

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, { env: this.env, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      const timer = setTimeout(() => child.kill('SIGTERM'), this.timeoutMs);
      child.on('error', error => { clearTimeout(timer); reject(new Error(`rclone spawn failed: ${error.message}`)); });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`rclone ${args[0]} failed (${signal ?? code}): ${stderr.trim()}`));
      });
    });
  }

  private streamHash(args: string[]): Promise<ObjectProof> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, { env: this.env, stdio: ['ignore', 'pipe', 'pipe'] });
      const hash = createHash('sha256');
      let bytes = 0;
      let stderr = '';
      child.stdout.on('data', chunk => { bytes += chunk.length; hash.update(chunk); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      const timer = setTimeout(() => child.kill('SIGTERM'), this.timeoutMs);
      child.on('error', error => { clearTimeout(timer); reject(new Error(`rclone spawn failed: ${error.message}`)); });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve({ bytes, sha256: hash.digest('hex') });
        else reject(new Error(`rclone ${args[0]} failed (${signal ?? code}): ${stderr.trim()}`));
      });
    });
  }
}

export async function hashFile(filePath: string): Promise<ObjectProof> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    let bytes = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => { bytes += chunk.length; hash.update(chunk); });
    stream.on('error', reject);
    stream.on('end', () => resolve({ bytes, sha256: hash.digest('hex') }));
  });
}
