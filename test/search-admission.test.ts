import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, insertExchange } from '../src/db.js';
import { searchConversations } from '../src/search.js';
import { readAdmittedConversation, shouldSkipConversation } from '../src/record-admission.js';

vi.mock('../src/embeddings.js', () => ({
  initEmbeddings: vi.fn(async () => {}),
  generateQueryEmbedding: vi.fn(async () => new Array(384).fill(0.1)),
}));
const marker = '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>';
const session = '00000000-1111-4222-8333-444444444444';
const message = (role: string, text: string) => ({ type: 'response_item', payload: {
  type: 'message', role, content: [{ type: 'input_text', text }],
} });
let root: string;
let previous: NodeJS.ProcessEnv;
beforeEach(() => {
  previous = { ...process.env };
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'em-search-admission-'));
  process.env.EPISODIC_MEMORY_CONFIG_DIR = root;
  process.env.TEST_DB_PATH = path.join(root, 'test.db');
  delete process.env.EPISODIC_MEMORY_DB_PATH;
});
afterEach(() => { vi.restoreAllMocks(); process.env = previous; fs.rmSync(root, { recursive: true, force: true }); });
function seed(id: string, timestamp = '2026-01-01T00:00:00Z') {
  const file = path.join(root, `${id}-${session}.jsonl`);
  fs.writeFileSync(file, [
    { type: 'session_meta', payload: { id: session } },
    message('user', `needle ${id}`), message('assistant', 'safe answer'),
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  const db = initDatabase();
  insertExchange(db, { id, project: 'fixture', timestamp, archivePath: file,
    lineStart: 2, lineEnd: 3, userMessage: `needle ${id}`, assistantMessage: 'safe answer', sessionId: session,
  }, new Array(384).fill(0.1));
  db.close(); return file;
}
function exclude(file: string, start = 2, end = 3) {
  fs.writeFileSync(path.join(root, 'record-exclusions.json'), JSON.stringify({ version: 1,
    exchanges: [{ session_id: session, transcript: path.basename(file), line_start: start, line_end: end }], tool_calls: [],
  }));
}

describe('decoded user instruction markers', () => {
  it('retains physical line coordinates while loading only a requested range', async () => {
    const file = path.join(root, 'range.jsonl');
    fs.writeFileSync(file, [message('user', 'outside'), message('assistant', 'selected \u2028 text'), message('user', 'outside after')].map(x => JSON.stringify(x)).join('\r\n'));
    const result = await readAdmittedConversation(file, 2, 2);
    expect(result.split('\n')).toHaveLength(3);
    expect(result.split('\n')[0]).toBe('');
    expect(result.split('\n')[1]).toContain('selected');
    expect(result).not.toContain('outside');
    fs.appendFileSync(file, '\n' + JSON.stringify(message('user', marker)));
    expect(await readAdmittedConversation(file, 2, 2)).toBe('');
  });

  it.each([
    ['assistant quote', message('assistant', marker)],
    ['tool output', { type: 'response_item', payload: { type: 'function_call_output', output: marker } }],
    ['Claude tool result', { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: marker }] } }],
  ])('does not opt out for %s', async (_, record) => {
    const file = path.join(root, 'quoted.jsonl');
    const bytes = JSON.stringify(record) + '\n'; fs.writeFileSync(file, bytes);
    expect(shouldSkipConversation(file)).toBe(false);
    expect(await readAdmittedConversation(file)).toContain(marker);
    expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
  });
  it.each([
    ['Codex response', message('user', marker)],
    ['Codex event', { type: 'event_msg', payload: { type: 'user_message', message: marker } }],
    ['Claude', { type: 'user', message: { role: 'user', content: marker } }],
    ['Cursor', { role: 'user', message: { content: marker } }],
    ['OMP', { type: 'message', message: { role: 'user', content: [{ type: 'text', text: marker }] } }],
    ['opencode', { type: 'opencode_message', message: { role: 'user' }, parts: [{ type: 'text', text: marker }] }],
  ])('honors JSON-escaped opt out in %s', async (_, record) => {
    const file = path.join(root, 'escaped.jsonl');
    fs.writeFileSync(file, JSON.stringify(record).replaceAll('<', '\\u003c'));
    expect(shouldSkipConversation(file)).toBe(true);
    expect(await readAdmittedConversation(file)).toBe('');
  });
});

describe('retained search admission', () => {
  it('orders admitted vectors by computed distance before applying the result limit', async () => {
    seed('far'); seed('near'); seed('middle');
    const db = initDatabase();
    const update = db.prepare('UPDATE vec_exchanges SET embedding = ? WHERE id = ?');
    for (const [id, coordinate] of [['far', 0.8], ['near', 0.1], ['middle', 0.3]] as const) {
      update.run(Buffer.from(new Float32Array(new Array(384).fill(coordinate)).buffer), id);
    }
    db.close();

    const results = await searchConversations('needle', { mode: 'vector', limit: 2 });
    expect(results.map(result => result.exchange.id)).toEqual(['near', 'middle']);
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity!);
  });

  it('applies the sidechain penalty to computed distance rather than storage order', async () => {
    seed('sidechain'); seed('primary');
    const db = initDatabase();
    db.prepare('UPDATE exchanges SET is_sidechain = 1 WHERE id = ?').run('sidechain');
    db.close();

    const results = await searchConversations('needle', { mode: 'vector', limit: 2 });
    expect(results.map(result => result.exchange.id)).toEqual(['primary', 'sidechain']);
    expect(results[0].similarity).toBeCloseTo(results[1].similarity!);
  });

  it('finds an admitted vector beyond the native KNN candidate ceiling', async () => {
    const file = seed('denied'); seed('safe');
    const db = initDatabase();
    db.transaction(() => {
      for (let i = 0; i < 4096; i++) {
        insertExchange(db, { id: `denied-${i}`, project: 'fixture', timestamp: '2026-01-01T00:00:00Z',
          archivePath: file, lineStart: 2, lineEnd: 3, userMessage: 'needle denied', assistantMessage: 'safe', sessionId: session,
        }, new Array(384).fill(0.1));
      }
      db.prepare('UPDATE vec_exchanges SET embedding = ? WHERE id = ?')
        .run(Buffer.from(new Float32Array(new Array(384).fill(0.2)).buffer), 'safe');
    })();
    db.close(); exclude(file);
    expect((await searchConversations('needle', { mode: 'vector', limit: 1 })).map(x => x.exchange.id)).toEqual(['safe']);
  });

  it('never follows a substituted transcript symlink', async () => {
    const file = seed('safe');
    fs.renameSync(file, file + '.original');
    fs.symlinkSync(file + '.original', file);
    await expect(searchConversations('needle', { mode: 'text' })).rejects.toThrow(/changed during record admission/);
  });
  it.each(['text', 'vector', 'both'] as const)('withholds a removed transcript without failing %s search', async mode => {
    seed('safe'); const removed = seed('removed', '2026-02-01T00:00:00Z');
    fs.rmSync(removed);
    const results = await searchConversations('needle', { mode, limit: 2 });
    expect(results.map(x => x.exchange.id)).toEqual(['safe']);
  });
  it('keeps an indexed exchange searchable while its transcript grows during admission', async () => {
    const file = seed('safe');
    const original = fs.readSync;
    let appended = false;
    vi.spyOn(fs, 'readSync').mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
      const count = original(...args);
      if (!appended && count > 0) {
        appended = true;
        fs.appendFileSync(file, JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'later' } }) + '\n');
      }
      return count;
    }) as typeof fs.readSync);

    const results = await searchConversations('needle', { mode: 'text', before: '2026-09-14' });
    expect(appended).toBe(true);
    expect(results.map(result => result.exchange.id)).toEqual(['safe']);
  });
  it('rejects an indexed-range rewrite even when the transcript also grows', async () => {
    const file = seed('safe');
    const summary = file.replace('.jsonl', '-summary.txt');
    fs.writeFileSync(summary, 'summary');
    const offset = fs.readFileSync(file).indexOf('needle safe');
    expect(offset).toBeGreaterThanOrEqual(0);
    const original = fs.readFileSync;
    let changed = false;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((p: any, ...args: any[]) => {
      if (p === summary && !changed) {
        changed = true;
        fs.appendFileSync(file, JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'later' } }) + '\n');
        const fd = fs.openSync(file, 'r+');
        try { fs.writeSync(fd, Buffer.from('secret safe'), 0, 11, offset); }
        finally { fs.closeSync(fd); }
      }
      return (original as any)(p, ...args);
    }) as typeof fs.readFileSync);

    await expect(searchConversations('needle', { mode: 'text' })).rejects.toThrow(/changed during record admission/);
    expect(changed).toBe(true);
  });
  it('rejects policy changes while building results', async () => {
    const file = seed('safe');
    const summary = file.replace('.jsonl', '-summary.txt'); fs.writeFileSync(summary, 'summary');
    const original = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((p: any, ...args: any[]) => {
      if (p === summary) exclude(file);
      return (original as any)(p, ...args);
    }) as typeof fs.readFileSync);
    await expect(searchConversations('needle', { mode: 'text' })).rejects.toThrow(/policy changed/);
  });

  it.each(['text', 'vector', 'both'] as const)('applies current exclusions before limit in %s mode', async mode => {
    seed('safe'); const denied = seed('denied', '2026-02-01T00:00:00Z');
    exclude(denied);
    const results = await searchConversations('needle', { mode, limit: 1 });
    expect(results.map(x => x.exchange.id)).toEqual(['safe']);
    expect(await readAdmittedConversation(denied)).not.toContain('needle denied');
  });
  it('rechecks opt-out appended after indexing, but not quoted tool output', async () => {
    const file = seed('later');
    fs.appendFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', output: marker } }) + '\n');
    expect(await searchConversations('needle', { mode: 'text' })).toHaveLength(1);
    fs.appendFileSync(file, JSON.stringify(message('user', marker)).replaceAll('<', '\\u003c') + '\n');
    expect(await searchConversations('needle', { mode: 'text' })).toEqual([]);
  });
  it('omits a stale whole-conversation summary when any source record is excluded', async () => {
    const file = seed('safe');
    fs.appendFileSync(file, JSON.stringify(message('user', 'excluded summary phrase')) + '\n');
    fs.writeFileSync(file.replace('.jsonl', '-summary.txt'), 'excluded summary phrase');
    exclude(file, 4, 4);
    const results = await searchConversations('needle', { mode: 'text' });
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results)).not.toContain('excluded summary phrase');
  });
  it('fails closed on invalid exclusion policy', async () => {
    seed('safe'); fs.writeFileSync(path.join(root, 'record-exclusions.json'), '{invalid');
    await expect(searchConversations('needle', { mode: 'text' })).rejects.toThrow(/exclusion policy/i);
  });
});
