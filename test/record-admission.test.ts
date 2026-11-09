import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncConversations } from '../src/sync.js';
import { parseConversation } from '../src/parser.js';
import { initDatabase, insertExchange } from '../src/db.js';
import { indexConversations, indexSession, indexUnprocessed } from '../src/indexer.js';
import { summarizeConversation, runCodexCommand } from '../src/summarizer.js';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { admittedConversationLines, archiveAdmittedConversation } from '../src/record-admission.js';

vi.mock('../src/embeddings.js', () => ({
  initEmbeddings: vi.fn(async () => {}),
  generateExchangeEmbedding: vi.fn(async () => new Array(384).fill(0)),
}));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
import { createRedactor, loadRedactionConfig } from '../src/redaction.js';
import type { ConversationExchange } from '../src/types.js';

const SESSION = '00000000-1111-4222-8333-444444444444';
const PRIVATE = 'public-fixture-excluded-content';
let root: string;
let source: string;
let archive: string;
let config: string;
let sourceFile: string;
let archiveFile: string;
let previous: NodeJS.ProcessEnv;

function message(role: string, text: string): object {
  return { type: 'response_item', timestamp: '2026-01-01T00:00:00Z',
    payload: { type: 'message', role, content: [{ type: 'text', text }] } };
}

function transcript(): string {
  return [
    { type: 'session_meta', payload: { id: SESSION, cwd: '/synthetic/project' } },
    message('user', 'safe question one'),
    message('assistant', 'safe answer one'),
    message('user', PRIVATE),
    message('assistant', PRIVATE),
    message('user', 'safe question two'),
    { type: 'response_item', payload: { type: 'function_call', call_id: 'call-denied', name: 'fixture', arguments: JSON.stringify({ value: PRIVATE }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-denied', output: PRIVATE } },
    message('assistant', 'safe answer two'),
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
}

function policy(value: object = {
  version: 1,
  exchanges: [{ session_id: SESSION, transcript: `rollout-${SESSION}.jsonl`, line_start: 4, line_end: 5 }],
  tool_calls: [{ session_id: SESSION, transcript: `rollout-${SESSION}.jsonl`, call_id: 'call-denied' }],
}): void {
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'record-exclusions.json'), JSON.stringify(value));
}

beforeEach(() => {
  previous = { ...process.env };
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'record-admission-'));
  source = path.join(root, 'source');
  archive = path.join(root, 'archive');
  config = path.join(root, 'config');
  process.env.EPISODIC_MEMORY_CONFIG_DIR = config;
  process.env.EPISODIC_MEMORY_DB_PATH = path.join(root, 'index.sqlite');
  delete process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS;
  process.env.TEST_PROJECTS_DIR = source;
  process.env.TEST_ARCHIVE_DIR = archive;
  fs.mkdirSync(path.join(source, '2026'), { recursive: true });
  sourceFile = path.join(source, '2026', `rollout-${SESSION}.jsonl`);
  archiveFile = path.join(archive, '2026', `rollout-${SESSION}.jsonl`);
  fs.writeFileSync(sourceFile, transcript());
});

afterEach(() => {
  process.env = previous;
  fs.rmSync(root, { recursive: true, force: true });
  expect(fs.existsSync(root)).toBe(false);
  vi.restoreAllMocks();
});

describe('persistent record exclusion at native ingestion boundaries', () => {
  it('redacts admitted records after exclusions without changing source coordinates', async () => {
    policy();
    const original = transcript().replace('safe question one', 'safe question one fixture_secret_1234');
    fs.writeFileSync(sourceFile, original.replace(/\n/g, '\r\n'));
    const before = fs.readFileSync(sourceFile);
    const redactor = createRedactor(loadRedactionConfig({ includeDefaults: false,
      rules: [{ id: 'fixture-secret', pattern: 'fixture_secret_[0-9]{4}' }] }));

    const result = await syncConversations(source, archive, { skipIndex: true, skipSummaries: true, redactor });

    expect(result.errors).toEqual([]);
    expect(result.redactions).toEqual([{ ruleId: 'fixture-secret', count: 1 }]);
    const copied = fs.readFileSync(archiveFile, 'utf8');
    expect(copied).not.toContain(PRIVATE);
    expect(copied).not.toContain('fixture_secret_1234');
    expect(copied).toContain('[REDACTED:fixture-secret]');
    expect(copied.split('\r\n')).toHaveLength(original.split('\n').length);
    const exchanges = await parseConversation(archiveFile, '2026', archiveFile);
    expect(exchanges.map(exchange => exchange.lineStart)).toEqual([2, 6]);
    expect(fs.readFileSync(sourceFile)).toEqual(before);
  });

  it('reapplies changed redaction rules when source mtime stays unchanged', async () => {
    const original = transcript().replace('safe question one', 'safe question one fixture_secret_1234');
    fs.writeFileSync(sourceFile, original);
    const redactor = createRedactor(loadRedactionConfig({ includeDefaults: false,
      rules: [{ id: 'fixture-secret', pattern: 'fixture_secret_[0-9]{4}' }] }));
    await syncConversations(source, archive, { skipIndex: true, skipSummaries: true, redactor: null });
    const before = fs.statSync(sourceFile).mtimeMs;

    const result = await syncConversations(source, archive, { skipIndex: true, skipSummaries: true, redactor });

    expect(result.copied).toBe(1);
    expect(fs.readFileSync(archiveFile, 'utf8')).not.toContain('fixture_secret_1234');
    expect(fs.statSync(sourceFile).mtimeMs).toBe(before);
    expect(fs.readFileSync(sourceFile, 'utf8')).toBe(original);
  });

  it('does not apply one transcript range to a sibling that shares its session', async () => {
    policy({ version: 1, exchanges: [{ session_id: SESSION, transcript: `rollout-${SESSION}.jsonl`, line_start: 4, line_end: 5 }], tool_calls: [] });
    const sibling = path.join(source, '2026', 'agent-sibling.jsonl');
    fs.writeFileSync(sibling, transcript());
    const result = await syncConversations(source, archive, { skipIndex: true, skipSummaries: true });
    expect(result.errors).toEqual([]);
    expect(fs.readFileSync(path.join(archive, '2026', 'agent-sibling.jsonl'), 'utf8')).toBe(transcript());
    const admitted = await parseConversation(archiveFile, '2026', archiveFile);
    expect(admitted.map(x => x.userMessage)).toEqual(['safe question one', 'safe question two']);
  });

  it('keeps the first transcript identity when fork history contains ancestor headers', async () => {
    policy({ version: 1, exchanges: [{ session_id: SESSION, transcript: `rollout-${SESSION}.jsonl`, line_start: 5, line_end: 6 }], tool_calls: [] });
    const rows = transcript().trimEnd().split('\n');
    rows.splice(1, 0, JSON.stringify({ type: 'session_meta', payload: { id: '00000000-aaaa-4bbb-8ccc-dddddddddddd' } }));
    fs.writeFileSync(sourceFile, rows.join('\n') + '\n');
    const result = await syncConversations(source, archive, { skipIndex: true, skipSummaries: true });
    expect(result.errors).toEqual([]);
    const exchanges = await parseConversation(archiveFile, '2026', archiveFile);
    expect(exchanges.map(x => x.userMessage)).toEqual(['safe question one', 'safe question two']);
    expect(exchanges.every(x => x.sessionId === SESSION)).toBe(true);
  });

  it('retains safe Claude text in a block shared with an excluded native tool call', async () => {
    policy({ version: 1, exchanges: [], tool_calls: [{ session_id: SESSION, transcript: `rollout-${SESSION}.jsonl`, call_id: 'toolu-denied' }] });
    const lines = [
      { type: 'user', sessionId: SESSION, message: { role: 'user', content: 'safe Claude question' } },
      { type: 'assistant', sessionId: SESSION, message: { role: 'assistant', content: [
        { type: 'text', text: 'safe Claude reply' },
        { type: 'tool_use', id: 'toolu-denied', name: 'fixture', input: { value: PRIVATE } },
        { type: 'tool_use', id: 'toolu-allowed', name: 'fixture', input: { value: 'safe input' } },
      ] } },
    ].map(JSON.stringify).join('\n') + '\n';
    fs.writeFileSync(sourceFile, lines);
    await syncConversations(source, archive, { skipIndex: true, skipSummaries: true });
    const copied = fs.readFileSync(archiveFile, 'utf8');
    expect(copied).not.toContain(PRIVATE);
    expect(copied).toContain('safe Claude reply');
    expect(copied).toContain('toolu-allowed');
    const exchanges = await parseConversation(sourceFile, 'fixture', archiveFile);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].toolCalls).toHaveLength(1);
    expect(exchanges[0].assistantMessage).toBe('safe Claude reply');
    expect(fs.readFileSync(sourceFile, 'utf8')).toBe(lines);
  });

  it('filters only denied records before copying and preserves physical line coordinates', async () => {
    policy();
    const before = fs.readFileSync(sourceFile);
    const result = await syncConversations(source, archive, { skipIndex: true, skipSummaries: true });
    expect(result.errors).toEqual([]);
    expect(fs.readFileSync(sourceFile)).toEqual(before);
    const copied = fs.readFileSync(archiveFile, 'utf8');
    expect(copied).not.toContain(PRIVATE);
    expect(copied.split('\n')).toHaveLength(transcript().split('\n').length);
    const exchanges = await parseConversation(archiveFile, '2026', archiveFile);
    expect(exchanges.map(x => x.userMessage)).toEqual(['safe question one', 'safe question two']);
    expect(exchanges.map(x => x.lineStart)).toEqual([2, 6]);
    expect(exchanges.flatMap(x => x.toolCalls ?? [])).toEqual([]);
  });

  it('applies exclusions when directly parsing original input without rewriting it', async () => {
    policy();
    const before = fs.readFileSync(sourceFile);
    const exchanges = await parseConversation(sourceFile, '2026', archiveFile);
    expect(exchanges.map(x => x.userMessage)).toEqual(['safe question one', 'safe question two']);
    expect(JSON.stringify(exchanges)).not.toContain(PRIVATE);
    expect(fs.readFileSync(sourceFile)).toEqual(before);
  });

  it('reapplies a changed policy even when source mtime did not advance', async () => {
    await syncConversations(source, archive, { skipIndex: true, skipSummaries: true });
    expect(fs.readFileSync(archiveFile, 'utf8')).toContain(PRIVATE);
    policy();
    await syncConversations(source, archive, { skipIndex: true, skipSummaries: true });
    expect(fs.readFileSync(archiveFile, 'utf8')).not.toContain(PRIVATE);
  });

  it('fails closed on malformed policy before any destination write', async () => {
    policy({ version: 1, exchanges: [{ session_id: SESSION, transcript: `rollout-${SESSION}.jsonl`, line_start: '4', line_end: 5 }], tool_calls: [] });
    await expect(syncConversations(source, archive, { skipIndex: true, skipSummaries: true })).rejects.toThrow(/record.*exclusion/i);
    expect(fs.existsSync(archiveFile)).toBe(false);
  });

  it('honors whole-conversation opt-out before any archive copy or parsing', async () => {
    const marker = '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>';
    fs.writeFileSync(sourceFile, transcript().replace('safe question one', marker));
    const original = fs.readFileSync(sourceFile);
    await syncConversations(source, archive, { skipIndex: true, skipSummaries: true });
    expect(fs.existsSync(archiveFile)).toBe(false);
    expect(await parseConversation(sourceFile, '2026', archiveFile)).toEqual([]);
    expect(fs.readFileSync(sourceFile)).toEqual(original);
  });

  it('rejects policy identity mismatch rather than silently selecting a different session', async () => {
    policy();
    fs.writeFileSync(sourceFile, transcript().replace(`"id":"${SESSION}"`, '"id":"00000000-aaaa-4bbb-8ccc-dddddddddddd"'));
    const result = await syncConversations(source, archive, { skipIndex: true, skipSummaries: true });
    expect(result.errors).toHaveLength(1);
    expect(fs.existsSync(archiveFile)).toBe(false);
  });

  it.each(['all', 'session', 'incremental'] as const)('does not report %s indexing success after an admission rejection', async mode => {
    policy();
    fs.writeFileSync(sourceFile, transcript().replace(`"id":"${SESSION}"`, '"id":"00000000-aaaa-4bbb-8ccc-dddddddddddd"'));
    const run = mode === 'all' ? indexConversations(undefined, undefined, 1, true)
      : mode === 'session' ? indexSession(SESSION, 1, true) : indexUnprocessed(1, true);
    await expect(run).rejects.toThrow(/session identity mismatch/);
    expect(fs.existsSync(archiveFile)).toBe(false);
  });

  it('fails closed when the policy itself is a symlink', async () => {
    policy();
    const file = path.join(config, 'record-exclusions.json');
    fs.renameSync(file, path.join(root, 'policy.json'));
    fs.symlinkSync(path.join(root, 'policy.json'), file);
    await expect(syncConversations(source, archive, { skipIndex: true, skipSummaries: true })).rejects.toThrow(/record.*exclusion/i);
    expect(fs.existsSync(archiveFile)).toBe(false);
  });

  it('rejects original/archive hardlink aliasing without modifying either input', async () => {
    policy();
    fs.mkdirSync(path.dirname(archiveFile), { recursive: true });
    fs.linkSync(sourceFile, archiveFile);
    const before = fs.readFileSync(sourceFile);
    const result = await syncConversations(source, archive, { skipIndex: true, skipSummaries: true });
    expect(result.errors).toHaveLength(1);
    expect(fs.readFileSync(sourceFile)).toEqual(before);
    expect(fs.statSync(sourceFile).ino).toBe(fs.statSync(archiveFile).ino);
  });

  it('rejects a symlinked destination parent without creating an external archive', async () => {
    policy();
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(archive);
    fs.symlinkSync(outside, path.dirname(archiveFile));
    await expect(archiveAdmittedConversation(sourceFile, archiveFile)).rejects.toThrow(/archive parent.*symlink/i);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('preserves nonmatching final newline bytes with an active empty policy', async () => {
    policy({ version: 1, exchanges: [], tool_calls: [] });
    const bytes = transcript().replace(/\n$/, '');
    fs.writeFileSync(sourceFile, bytes);
    await syncConversations(source, archive, { skipIndex: true, skipSummaries: true });
    expect(fs.readFileSync(archiveFile, 'utf8')).toBe(bytes);
  });

  it('refreshes an archive when the source grows but its mtime ties the archive', async () => {
    expect(await archiveAdmittedConversation(sourceFile, archiveFile)).toBe(true);
    const archiveTime = fs.statSync(archiveFile).mtime;
    fs.appendFileSync(sourceFile, JSON.stringify(message('user', 'An appended safe exchange')) + '\n');
    fs.utimesSync(sourceFile, archiveTime, archiveTime);

    expect(await archiveAdmittedConversation(sourceFile, archiveFile)).toBe(true);
    expect(fs.readFileSync(archiveFile)).toEqual(fs.readFileSync(sourceFile));
  });

  it('rejects source mutation during streaming without publishing a derived file', async () => {
    policy();
    const original = fs.createReadStream;
    let changed = false;
    vi.spyOn(fs, 'createReadStream').mockImplementation(((file: any, options: any) => {
      if (file === sourceFile && !changed) {
        changed = true;
        fs.appendFileSync(sourceFile, JSON.stringify(message('user', 'later public content')) + '\n');
      }
      return original(file, options);
    }) as typeof fs.createReadStream);
    await expect(archiveAdmittedConversation(sourceFile, archiveFile)).rejects.toThrow(/changed during record admission/);
    expect(fs.existsSync(archiveFile)).toBe(false);
    expect(fs.readdirSync(path.dirname(archiveFile))).toEqual([]);
  });

  it('does not copy unscanned bytes when an opt-out is appended without a record policy', async () => {
    const original = fs.createReadStream;
    const copy = fs.copyFileSync;
    let changed = false;
    const change = () => {
      if (!changed) {
        changed = true;
        fs.appendFileSync(sourceFile, JSON.stringify(message('user', '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>')) + '\n');
      }
    };
    vi.spyOn(fs, 'createReadStream').mockImplementation(((file: any, options: any) => {
      if (file === sourceFile) change();
      return original(file, options);
    }) as typeof fs.createReadStream);
    vi.spyOn(fs, 'copyFileSync').mockImplementation(((src: any, dest: any, flags: any) => {
      if (src === sourceFile) change();
      return copy(src, dest, flags);
    }) as typeof fs.copyFileSync);
    await expect(archiveAdmittedConversation(sourceFile, archiveFile)).rejects.toThrow(/changed during record admission/);
    expect(fs.existsSync(archiveFile)).toBe(false);
  });

  it('rejects a policy change during a derived copy rather than publishing stale admission', async () => {
    policy({ version: 1, exchanges: [], tool_calls: [] });
    const original = fs.createReadStream;
    let changed = false;
    vi.spyOn(fs, 'createReadStream').mockImplementation(((file: any, options: any) => {
      if (file === sourceFile && !changed) { changed = true; policy(); }
      return original(file, options);
    }) as typeof fs.createReadStream);
    await expect(archiveAdmittedConversation(sourceFile, archiveFile)).rejects.toThrow(/policy changed during record admission/);
    expect(fs.existsSync(archiveFile)).toBe(false);
    expect(fs.readdirSync(path.dirname(archiveFile))).toEqual([]);
  });

  it('rejects a parser input replaced between marker scan and stream consumption', async () => {
    policy();
    const original = fs.createReadStream;
    let changed = false;
    vi.spyOn(fs, 'createReadStream').mockImplementation(((file: any, options: any) => {
      if (file === sourceFile && !changed) {
        changed = true;
        fs.renameSync(sourceFile, sourceFile + '.previous');
        fs.writeFileSync(sourceFile, transcript());
      }
      return original(file, options);
    }) as typeof fs.createReadStream);
    await expect((async () => {
      for await (const _line of admittedConversationLines(sourceFile)) { /* Consume to the verification boundary. */ }
    })()).rejects.toThrow(/changed during record admission/);
  });

  it('does not let project-exclusion environment override record policy', async () => {
    policy();
    process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS = 'unrelated-project';
    await syncConversations(source, archive, { skipIndex: true, skipSummaries: true });
    expect(fs.readFileSync(archiveFile, 'utf8')).not.toContain(PRIVATE);
  });

  it.each(['all', 'session', 'incremental'] as const)('filters before the %s index archive copy', async mode => {
    policy();
    if (mode === 'all') await indexConversations(undefined, undefined, 1, true);
    if (mode === 'session') await indexSession(SESSION, 1, true);
    if (mode === 'incremental') await indexUnprocessed(1, true);
    expect(fs.readFileSync(archiveFile, 'utf8')).not.toContain(PRIVATE);
    const db = initDatabase();
    try {
      expect(db.prepare('SELECT count(*) AS n FROM exchanges').get()).toEqual({ n: 2 });
      expect(db.prepare('SELECT count(*) AS n FROM tool_calls').get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });

  it('starts an ephemeral Codex text-only context rather than forking hidden history', async () => {
    const fake = `
      const readline = require('readline');
      const lines = readline.createInterface({ input: process.stdin });
      const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
      lines.on('line', line => {
        const m = JSON.parse(line);
        if (m.method === 'initialize') emit({ id: m.id, result: {} });
        if (m.method === 'thread/fork') process.exit(9);
        if (m.method === 'thread/start') {
          if (!m.params.ephemeral || m.params.threadId) process.exit(10);
          emit({ id: m.id, result: { thread: { id: 'synthetic-ephemeral' } } });
        }
        if (m.method === 'turn/start') {
          emit({ id: m.id, result: { turn: { id: 'synthetic-turn' } } });
          emit({ method: 'item/completed', params: { item: { type: 'agentMessage', text: '<summary>Safe text only.</summary>' } } });
          emit({ method: 'turn/completed', params: { turn: { id: 'synthetic-turn', status: 'completed' } } });
        }
      });
    `;
    expect(await runCodexCommand({ command: process.execPath, args: ['-e', fake],
      prompt: 'Only synthetic admitted content.', skipVersionCheck: true })).toContain('Safe text only.');
  });

  it('does not resume a source session when a native record policy is active', async () => {
    policy();
    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result', is_error: false, result: '<summary>Safe summary.</summary>' };
      },
    } as any);
    const exchange: ConversationExchange = { id: 'safe-summary', project: 'fixture',
      timestamp: '2026-01-01T00:00:00Z', userMessage: 'Explain the selected project architecture and its acceptance boundaries.',
      assistantMessage: 'This is an ordinary safe answer that must remain available for summarization without any original hidden session context.',
      archivePath: archiveFile, lineStart: 2, lineEnd: 3, sessionId: SESSION, harness: 'claude' };
    expect(await summarizeConversation([exchange], SESSION)).toBe('Safe summary.');
    const request = vi.mocked(query).mock.calls.at(-1)![0];
    expect(request.options.resume).toBeUndefined();
    expect(request.prompt).toContain(exchange.userMessage);
    expect(request.prompt).not.toContain(PRIVATE);
  });

  it('does not route a policy-admitted Codex transcript without a session ID to Claude', async () => {
    policy();
    process.env.EPISODIC_MEMORY_CODEX_BIN = path.join(root, 'missing-codex');
    vi.mocked(query).mockReset();
    vi.mocked(query).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'result', is_error: false, result: '<summary>Wrong provider.</summary>' };
      },
    } as any);
    const exchange: ConversationExchange = { id: 'codex-no-id', project: 'fixture',
      timestamp: '2026-01-01T00:00:00Z', userMessage: 'Explain the selected project architecture and its acceptance boundaries.',
      assistantMessage: 'This admitted answer is long enough to require a summary but must never reach a different provider.',
      archivePath: archiveFile, lineStart: 2, lineEnd: 3, harness: 'codex' };

    await expect(summarizeConversation([exchange])).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses direct database reinsertion after native deletion across reopen', () => {
    policy();
    const exchange: ConversationExchange = { id: 'denied-body', project: 'fixture',
      timestamp: '2026-01-01T00:00:00Z', userMessage: PRIVATE, assistantMessage: PRIVATE,
      archivePath: archiveFile, lineStart: 4, lineEnd: 5, sessionId: SESSION, harness: 'codex' };
    for (let n = 0; n < 2; n++) {
      const db = initDatabase();
      try {
        insertExchange(db, exchange, new Array(384).fill(0));
        expect(db.prepare('SELECT count(*) AS n FROM exchanges').get()).toEqual({ n: 0 });
        expect(db.prepare('SELECT count(*) AS n FROM vec_exchanges').get()).toEqual({ n: 0 });
      } finally { db.close(); }
    }
  });

  it('does not trust an inherited ancestor ID over the transcript identity at direct insertion', () => {
    policy();
    const db = initDatabase();
    try {
      const exchange: ConversationExchange = { id: 'ancestor-metadata', project: 'fixture',
        timestamp: '2026-01-01T00:00:00Z', userMessage: PRIVATE, assistantMessage: PRIVATE,
        archivePath: archiveFile, lineStart: 4, lineEnd: 5,
        sessionId: '00000000-aaaa-4bbb-8ccc-dddddddddddd', harness: 'codex' };
      insertExchange(db, exchange, new Array(384).fill(0));
      expect(db.prepare('SELECT count(*) AS n FROM exchanges').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT count(*) AS n FROM vec_exchanges').get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });

  it('filters denied native tool IDs even when direct callers retain ancestor metadata', () => {
    policy();
    const db = initDatabase();
    try {
      const exchange: ConversationExchange = { id: 'ancestor-safe-body', project: 'fixture',
        timestamp: '2026-01-01T00:00:00Z', userMessage: 'safe question', assistantMessage: 'safe answer',
        archivePath: archiveFile, lineStart: 6, lineEnd: 9,
        sessionId: '00000000-aaaa-4bbb-8ccc-dddddddddddd', harness: 'codex',
        toolCalls: [{ id: 'call-denied', exchangeId: 'ancestor-safe-body', toolName: 'fixture',
          toolInput: { value: PRIVATE }, toolResult: PRIVATE, isError: false, timestamp: '2026-01-01T00:00:00Z' }] };
      insertExchange(db, exchange, new Array(384).fill(0));
      expect(db.prepare('SELECT count(*) AS n FROM exchanges').get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT count(*) AS n FROM tool_calls').get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });

  it('retains a safe body but removes denied tool calls at database insertion', () => {
    policy();
    const db = initDatabase();
    try {
      const exchange: ConversationExchange = { id: 'safe-body', project: 'fixture',
        timestamp: '2026-01-01T00:00:00Z', userMessage: 'safe question', assistantMessage: 'safe answer',
        archivePath: archiveFile, lineStart: 6, lineEnd: 9, sessionId: SESSION, harness: 'codex',
        toolCalls: [{ id: 'call-denied', exchangeId: 'safe-body', toolName: 'fixture', toolInput: { value: PRIVATE }, toolResult: PRIVATE, isError: false, timestamp: '2026-01-01T00:00:00Z' }] };
      insertExchange(db, exchange, new Array(384).fill(0));
      expect(db.prepare('SELECT count(*) AS n FROM exchanges').get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT count(*) AS n FROM tool_calls').get()).toEqual({ n: 0 });
      expect(exchange.toolCalls).toHaveLength(1);
    } finally { db.close(); }
  });
});
