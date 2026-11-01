import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cloneOrCopyFileSync } from '../src/clone-copy.js';

describe('cloneOrCopyFileSync', () => {
  let dir: string;
  let src: string;
  let dest: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'em-clone-copy-'));
    src = join(dir, 'src.jsonl');
    dest = join(dir, 'dest.jsonl');
    writeFileSync(src, '{"type":"user"}\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('produces an identical, independent file', () => {
    cloneOrCopyFileSync(src, dest);

    expect(readFileSync(dest, 'utf8')).toBe('{"type":"user"}\n');
    expect(statSync(dest).ino).not.toBe(statSync(src).ino);

    // Appending to the live transcript must not leak into the archive copy.
    appendFileSync(src, '{"type":"assistant"}\n');
    expect(readFileSync(dest, 'utf8')).toBe('{"type":"user"}\n');
  });

  it('clones with `cp -c` on macOS', () => {
    const calls: string[][] = [];
    cloneOrCopyFileSync(src, dest, {
      platform: 'darwin',
      runCp: (args) => {
        calls.push(args);
        writeFileSync(dest, readFileSync(src));
      },
    });

    expect(calls).toEqual([['-c', src, dest]]);
  });

  it('falls back to a plain copy when cloning fails', () => {
    cloneOrCopyFileSync(src, dest, {
      platform: 'darwin',
      runCp: () => {
        throw new Error('clonefile: Operation not supported');
      },
    });

    expect(readFileSync(dest, 'utf8')).toBe('{"type":"user"}\n');
  });

  it('does not shell out on other platforms', () => {
    let called = false;
    cloneOrCopyFileSync(src, dest, {
      platform: 'linux',
      runCp: () => {
        called = true;
      },
    });

    expect(called).toBe(false);
    expect(readFileSync(dest, 'utf8')).toBe('{"type":"user"}\n');
  });
});
