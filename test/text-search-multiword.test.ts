import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDatabase, insertExchange } from '../src/db.js';
import {
  buildTextMatchClause,
  escapeLikePattern,
  searchConversations,
  tokenizeTextQuery,
} from '../src/search.js';
import { ConversationExchange } from '../src/types.js';

describe('multi-word text search (#127)', () => {
  let testDir: string;
  const originalDbPath = process.env.TEST_DB_PATH;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-text-multiword-'));
    process.env.TEST_DB_PATH = join(testDir, 'index.sqlite');
  });

  afterEach(() => {
    if (originalDbPath === undefined) delete process.env.TEST_DB_PATH;
    else process.env.TEST_DB_PATH = originalDbPath;
    rmSync(testDir, { recursive: true, force: true });
  });

  function seedExchange(partial: Partial<ConversationExchange> & Pick<ConversationExchange, 'id' | 'userMessage' | 'assistantMessage'>): void {
    const archiveDir = join(testDir, 'archive');
    mkdirSync(archiveDir, { recursive: true });
    const archivePath = join(archiveDir, `${partial.id}.jsonl`);
    writeFileSync(archivePath, '{}\n', 'utf-8');

    const db = initDatabase();
    const exchange: ConversationExchange = {
      project: 'test-project',
      timestamp: '2026-05-12T20:00:00.000Z',
      lineStart: 1,
      lineEnd: 2,
      archivePath,
      harness: 'claude',
      sessionId: `session-${partial.id}`,
      ...partial,
    };
    insertExchange(db, exchange, new Array(384).fill(0.1));
    db.close();
  }

  it('tokenizes multi-word queries on whitespace', () => {
    expect(tokenizeTextQuery('date filter empty results')).toEqual([
      'date',
      'filter',
      'empty',
      'results',
    ]);
    expect(tokenizeTextQuery('  authentication   login  ')).toEqual([
      'authentication',
      'login',
    ]);
    expect(tokenizeTextQuery('single')).toEqual(['single']);
    expect(tokenizeTextQuery('   ')).toEqual([]);
  });

  it('escapes LIKE wildcards in patterns', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('a\\b%')).toBe('a\\\\b\\%');
  });

  it('builds AND-ed per-token LIKE clauses', () => {
    const { sql, params } = buildTextMatchClause('authentication login');
    expect(sql).toBe(
      `(e.user_message LIKE ? ESCAPE '\\' OR e.assistant_message LIKE ? ESCAPE '\\')` +
        ` AND ` +
        `(e.user_message LIKE ? ESCAPE '\\' OR e.assistant_message LIKE ? ESCAPE '\\')`
    );
    expect(params).toEqual([
      '%authentication%',
      '%authentication%',
      '%login%',
      '%login%',
    ]);
  });

  it('matches multi-word queries when terms appear non-contiguously', async () => {
    // Repro from #127: words present but not as one contiguous substring.
    seedExchange({
      id: 'auth-login',
      userMessage: 'I fixed the authentication bug in the login flow',
      assistantMessage: 'Nice work on the fix.',
    });
    seedExchange({
      id: 'unrelated',
      userMessage: 'How do I configure logging only?',
      assistantMessage: 'Check the logging docs.',
    });

    const results = await searchConversations('authentication login', {
      mode: 'text',
      limit: 10,
    });

    const ids = results.map(r => r.exchange.id);
    expect(ids).toContain('auth-login');
    expect(ids).not.toContain('unrelated');
  });

  it('still matches a single-word query', async () => {
    seedExchange({
      id: 'single-hit',
      userMessage: 'Discussing authentication strategies',
      assistantMessage: 'Use OAuth.',
    });

    const results = await searchConversations('authentication', {
      mode: 'text',
      limit: 10,
    });

    expect(results.map(r => r.exchange.id)).toContain('single-hit');
  });

  it('requires every term (AND semantics) — missing term excludes the row', async () => {
    seedExchange({
      id: 'partial',
      userMessage: 'authentication only, no other keywords',
      assistantMessage: 'ok',
    });

    const results = await searchConversations('authentication login', {
      mode: 'text',
      limit: 10,
    });

    expect(results.map(r => r.exchange.id)).not.toContain('partial');
  });

  it('matches terms split across user and assistant messages', async () => {
    seedExchange({
      id: 'split-fields',
      userMessage: 'Please review the authentication changes',
      assistantMessage: 'The login path looks solid.',
    });

    const results = await searchConversations('authentication login', {
      mode: 'text',
      limit: 10,
    });

    expect(results.map(r => r.exchange.id)).toContain('split-fields');
  });

  it('treats % and _ in the query as literals, not LIKE wildcards', async () => {
    seedExchange({
      id: 'percent-literal',
      userMessage: 'Coverage is now 100% for the module',
      assistantMessage: 'Great.',
    });
    seedExchange({
      id: 'percent-false-positive',
      userMessage: 'Coverage is now 100X for the module',
      assistantMessage: 'Hmm.',
    });

    const results = await searchConversations('100%', {
      mode: 'text',
      limit: 10,
    });

    const ids = results.map(r => r.exchange.id);
    expect(ids).toContain('percent-literal');
    expect(ids).not.toContain('percent-false-positive');
  });
});
