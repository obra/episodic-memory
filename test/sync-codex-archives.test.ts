import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { syncConversations } from '../src/sync.js';
import { archivedRolloutRelativePath } from '../src/paths.js';

const zstdAvailable = typeof (zlib as any).zstdCompressSync === 'function';
const SESSION = '019f0000-0000-7000-8000-000000000001';
const NAME = `rollout-2026-10-15T10-00-01-${SESSION}.jsonl`;

let root: string;
let archive: string;

function codexLines(turns: number, from = 1): string {
  const lines: string[] = [];
  if (from === 1) lines.push(JSON.stringify({ type: 'session_meta', payload: { id: SESSION, cwd: '/synthetic' } }));
  for (let turn = from; turn < from + turns; turn++) {
    lines.push(JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user',
      content: [{ type: 'input_text', text: `question ${turn}` }] } }));
    lines.push(JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: `answer ${turn}` }] } }));
  }
  return lines.join('\n') + '\n';
}

function write(file: string, content: string, compressed: boolean): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, compressed ? (zlib as any).zstdCompressSync(Buffer.from(content)) : content);
  return file;
}

// A later source time, as when Codex archives or rewrites a rollout after it was synced.
function later(file: string): void {
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(file, future, future);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-codex-archives-'));
  archive = path.join(root, 'archive');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Codex archived rollouts', () => {
  it('maps a flat archived rollout to its dated archive path', () => {
    expect(archivedRolloutRelativePath(`${NAME}.zst`)).toBe(path.join('2026', '10', '15', NAME));
    expect(archivedRolloutRelativePath(NAME)).toBe(path.join('2026', '10', '15', NAME));
    expect(archivedRolloutRelativePath('notes.jsonl')).toBeNull();
  });

  it('archives an uncompressed rollout from archived_sessions at its dated path', async () => {
    const sourceDir = path.join(root, 'archived_sessions');
    write(path.join(sourceDir, NAME), codexLines(1), false);
    const result = await syncConversations(sourceDir, archive, { skipIndex: true, skipSummaries: true });
    expect(result.copied).toBe(1);
    expect(fs.readFileSync(path.join(archive, '2026', '10', '15', NAME), 'utf8')).toBe(codexLines(1));
  });
});

describe.skipIf(!zstdAvailable)('compressed Codex rollouts', () => {
  it('archives a compressed archived rollout as the plain transcript it holds', async () => {
    const sourceDir = path.join(root, 'archived_sessions');
    write(path.join(sourceDir, `${NAME}.zst`), codexLines(2), true);
    const result = await syncConversations(sourceDir, archive, { skipIndex: true, skipSummaries: true });
    expect(result.copied).toBe(1);
    expect(fs.readFileSync(path.join(archive, '2026', '10', '15', NAME), 'utf8')).toBe(codexLines(2));

    const again = await syncConversations(sourceDir, archive, { skipIndex: true, skipSummaries: true });
    expect(again.copied).toBe(0);
  });

  it('archives a compressed rollout inside the sessions tree without its .zst suffix', async () => {
    const sourceDir = path.join(root, 'sessions');
    write(path.join(sourceDir, '2026', '10', '15', `${NAME}.zst`), codexLines(1), true);
    const result = await syncConversations(sourceDir, archive, { skipIndex: true, skipSummaries: true });
    expect(result.copied).toBe(1);
    expect(fs.existsSync(path.join(archive, '2026', '10', '15', NAME))).toBe(true);
  });

  it('extends an archived plain rollout from its compressed continuation', async () => {
    const live = path.join(root, 'sessions');
    const plain = write(path.join(live, '2026', '10', '15', NAME), codexLines(1), false);
    await syncConversations(live, archive, { skipIndex: true, skipSummaries: true });

    // Codex moves the finished rollout out of sessions/ and compresses it.
    fs.rmSync(plain);
    const archived = path.join(root, 'archived_sessions');
    later(write(path.join(archived, `${NAME}.zst`), codexLines(1) + codexLines(1, 2), true));
    const result = await syncConversations(archived, archive, { skipIndex: true, skipSummaries: true });
    expect(result.copied).toBe(1);
    expect(fs.readFileSync(path.join(archive, '2026', '10', '15', NAME), 'utf8')).toBe(codexLines(1) + codexLines(1, 2));
  });

  it('keeps an archive whose compressed source was rewritten, and does not decompress it again', async () => {
    const live = path.join(root, 'sessions');
    const plain = write(path.join(live, '2026', '10', '15', NAME), codexLines(2), false);
    await syncConversations(live, archive, { skipIndex: true, skipSummaries: true });
    const target = path.join(archive, '2026', '10', '15', NAME);
    const previous = fs.readFileSync(target, 'utf8');

    // A format migration rewrites every record before the rollout is compressed.
    fs.rmSync(plain);
    const rewritten = codexLines(2).trimEnd().split('\n')
      .map((line, ordinal) => JSON.stringify({ ordinal, ...JSON.parse(line) })).join('\n') + '\n';
    const archived = path.join(root, 'archived_sessions');
    const source = write(path.join(archived, `${NAME}.zst`), rewritten, true);
    later(source);
    const result = await syncConversations(archived, archive, { skipIndex: true, skipSummaries: true });
    expect(result.copied).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe(previous);
    // The kept archive carries the source time, so an unchanged rewrite is current next time.
    expect(fs.statSync(target).mtimeMs).toBeGreaterThanOrEqual(fs.statSync(source).mtimeMs);
    expect(fs.readdirSync(path.dirname(target)).filter(name => name.includes('.tmp.'))).toEqual([]);
  });
});
