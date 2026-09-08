import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { indexUnprocessed } from '../src/indexer.js';
import { searchConversations } from '../src/search.js';
import { suppressConsole } from './test-utils.js';

/**
 * Build one user/assistant exchange with a controllable `isSidechain` flag so
 * we can verify how subagent/workflow transcripts (which the harness records
 * with `isSidechain: true`) are treated by search. Content optionally embeds a
 * `topic` so semantic queries can find it, or an explicit user/assistant body
 * when the exact text matters (text-match contract tests).
 */
function makeExchangeLines(opts: {
  seq: number;
  sessionId: string;
  isSidechain: boolean;
  topic?: string;
  userText?: string;
  assistantText?: string;
}): string {
  const { seq, sessionId, isSidechain, topic } = opts;
  const userText = opts.userText ?? `Question about ${topic}`;
  const assistantText = opts.assistantText ?? `Answer about ${topic}`;
  const userUuid = `u-${seq}-${sessionId}`;
  const assistantUuid = `a-${seq}-${sessionId}`;
  const ts = new Date(2026, 0, 1 + seq).toISOString();
  const userLine = JSON.stringify({
    parentUuid: null,
    isSidechain,
    userType: 'external',
    cwd: '/test/project',
    sessionId,
    version: '2.0.9',
    gitBranch: 'main',
    type: 'user',
    message: { role: 'user', content: userText },
    uuid: userUuid,
    timestamp: ts,
  });
  const assistantLine = JSON.stringify({
    parentUuid: userUuid,
    isSidechain,
    userType: 'external',
    cwd: '/test/project',
    sessionId,
    version: '2.0.9',
    gitBranch: 'main',
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5',
      role: 'assistant',
      content: [{ type: 'text', text: assistantText }],
    },
    uuid: assistantUuid,
    timestamp: ts,
  });
  return userLine + '\n' + assistantLine + '\n';
}

describe('search sidechain visibility', () => {
  let testDir: string;
  let projectsDir: string;
  let restoreConsole: () => void;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-sidechain-test-'));
    projectsDir = join(testDir, 'projects');
    mkdirSync(projectsDir, { recursive: true });
    mkdirSync(join(testDir, 'config'), { recursive: true });

    process.env.TEST_PROJECTS_DIR = projectsDir;
    process.env.TEST_ARCHIVE_DIR = join(testDir, 'archive');
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir, 'config');
    process.env.TEST_DB_PATH = join(testDir, 'test.db');
    restoreConsole = suppressConsole();
  });

  afterEach(() => {
    restoreConsole();
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.TEST_ARCHIVE_DIR;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    delete process.env.TEST_DB_PATH;
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  /** Write a project of session files and index them into a fresh DB. */
  async function seed(project: string, files: Record<string, string>): Promise<void> {
    const dir = join(projectsDir, project);
    mkdirSync(dir, { recursive: true });
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(dir, name), contents, 'utf-8');
    }
    await indexUnprocessed(1, true);
  }

  it('AC-1 (vector): finds a conversation whose substantive work ran in a subagent', async () => {
    // The only exchange discussing this topic is a sidechain (subagent) row.
    await seed('proj', {
      'sub.jsonl': makeExchangeLines({
        seq: 1, sessionId: 's-sub', isSidechain: true, topic: 'idempotent migration rollback strategy',
      }),
    });

    const results = await searchConversations('idempotent migration rollback strategy', {
      mode: 'vector', limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.exchange.isSidechain)).toBe(true);
  });

  it('AC-1 (text): finds subagent work via exact text search', async () => {
    await seed('proj', {
      'sub.jsonl': makeExchangeLines({
        seq: 1, sessionId: 's-sub', isSidechain: true, topic: 'idempotent migration rollback strategy',
      }),
    });

    const results = await searchConversations('idempotent migration rollback strategy', {
      mode: 'text', limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.exchange.isSidechain)).toBe(true);
  });

  it('include_sidechains: false restores the old behavior (excludes sidechains)', async () => {
    await seed('proj', {
      'sub.jsonl': makeExchangeLines({
        seq: 1, sessionId: 's-sub', isSidechain: true, topic: 'idempotent migration rollback strategy',
      }),
    });

    const vector = await searchConversations('idempotent migration rollback strategy', {
      mode: 'vector', limit: 10, include_sidechains: false,
    });
    const text = await searchConversations('idempotent migration rollback strategy', {
      mode: 'text', limit: 10, include_sidechains: false,
    });

    expect(vector).toEqual([]);
    expect(text).toEqual([]);
  });

  it('de-ranks sidechains below equally-relevant main-thread rows (vector)', async () => {
    // Identical content in two files: same embedding, same distance to the
    // query, so ordering is decided purely by the sidechain de-rank penalty.
    const body = { topic: 'connection pool exhaustion under load' };
    await seed('proj', {
      'main.jsonl': makeExchangeLines({ seq: 1, sessionId: 's-main', isSidechain: false, ...body }),
      'sub.jsonl': makeExchangeLines({ seq: 2, sessionId: 's-sub', isSidechain: true, ...body }),
    });

    const results = await searchConversations('connection pool exhaustion under load', {
      mode: 'vector', limit: 10,
    });

    expect(results.length).toBe(2);
    expect(results[0].exchange.isSidechain).toBe(false);
    expect(results[1].exchange.isSidechain).toBe(true);
  });

  it('de-ranks sidechains below main-thread rows (text)', async () => {
    const body = { topic: 'connection pool exhaustion under load' };
    await seed('proj', {
      'main.jsonl': makeExchangeLines({ seq: 1, sessionId: 's-main', isSidechain: false, ...body }),
      'sub.jsonl': makeExchangeLines({ seq: 2, sessionId: 's-sub', isSidechain: true, ...body }),
    });

    const results = await searchConversations('connection pool exhaustion under load', {
      mode: 'text', limit: 10,
    });

    expect(results.length).toBe(2);
    expect(results[0].exchange.isSidechain).toBe(false);
    expect(results[1].exchange.isSidechain).toBe(true);
  });

  it('returns both main-thread and sidechain rows by default', async () => {
    await seed('proj', {
      'main.jsonl': makeExchangeLines({ seq: 1, sessionId: 's-main', isSidechain: false, topic: 'retry backoff jitter' }),
      'sub.jsonl': makeExchangeLines({ seq: 2, sessionId: 's-sub', isSidechain: true, topic: 'retry backoff jitter' }),
    });

    const results = await searchConversations('retry backoff jitter', { mode: 'both', limit: 10 });
    const kinds = new Set(results.map(r => r.exchange.isSidechain));
    expect(kinds.has(false)).toBe(true);
    expect(kinds.has(true)).toBe(true);
  });

  // AC-3: pin the text path's matching contract as it ships — the whole query
  // is matched as one contiguous, case-insensitive substring (no tokenization).
  // Text search is a multi-word AND of per-token LIKEs (#144): a query matches
  // when every word appears somewhere in the exchange, in any order. This
  // supersedes the older whole-query "contiguous substring" contract.
  describe('text-match contract (multi-word AND of tokens, #144)', () => {
    beforeEach(async () => {
      await seed('proj', {
        's.jsonl': makeExchangeLines({
          seq: 1, sessionId: 's-1', isSidechain: false,
          userText: 'We tuned the alpha beta gamma delta pipeline today',
          assistantText: 'Noted the pipeline change.',
        }),
      });
    });

    it('matches when all query words are present (contiguous order)', async () => {
      const results = await searchConversations('alpha beta gamma', { mode: 'text', limit: 10 });
      expect(results.length).toBe(1);
    });

    it('matches regardless of word order — tokens are AND-ed, not a substring (#144)', async () => {
      const results = await searchConversations('gamma alpha beta', { mode: 'text', limit: 10 });
      expect(results.length).toBe(1);
    });

    it('does not match when the query includes a word absent from the run', async () => {
      const results = await searchConversations('alpha beta epsilon gamma', { mode: 'text', limit: 10 });
      expect(results).toEqual([]);
    });
  });
});
