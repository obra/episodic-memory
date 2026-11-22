import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// On Windows, a console program started from a process with no console of its
// own (the detached background sync, the summarizer it runs) gets a brand-new
// console window unless the spawn passes `windowsHide: true`. Users saw a
// terminal window flash for every background sync and every `codex app-server`
// summarizer call. Every spawn in src/ must hide its window.
const SRC_DIR = join(__dirname, '..', 'src');

function spawnCallOptions(source: string): string[] {
  const calls: string[] = [];
  const pattern = /\bspawn\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(match.index, end + 1));
  }
  return calls;
}

describe('child processes hide their console window on Windows', () => {
  const files = readdirSync(SRC_DIR).filter(name => name.endsWith('.ts'));
  const calls = files.flatMap(name =>
    spawnCallOptions(readFileSync(join(SRC_DIR, name), 'utf8')).map(call => ({ name, call }))
  );

  it('finds the spawn calls it checks', () => {
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });

  it.each(calls.map(({ name, call }) => [name, call.split('\n')[0], call]))(
    '%s: %s',
    (_name, _firstLine, call) => {
      expect(call).toMatch(/windowsHide:\s*true/);
    }
  );
});
