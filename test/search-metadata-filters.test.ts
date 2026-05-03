import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { indexUnprocessed } from '../src/indexer.js';
import { searchConversations } from '../src/search.js';
import { suppressConsole } from './test-utils.js';

/**
 * Build one user/assistant exchange with controllable metadata fields so we
 * can verify filtering on them later. The exchange's text content embeds the
 * `topic` so semantic queries can find it.
 */
function makeExchangeLines(opts: {
  seq: number;
  sessionId: string;
  gitBranch: string;
  topic: string;
}): string {
  const { seq, sessionId, gitBranch, topic } = opts;
  const userUuid = `u-${seq}-${sessionId}`;
  const assistantUuid = `a-${seq}-${sessionId}`;
  const ts = new Date(2026, 0, 1 + seq).toISOString();
  const userLine = JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: '/test/project',
    sessionId,
    version: '2.0.9',
    gitBranch,
    type: 'user',
    message: { role: 'user', content: `Question about ${topic}` },
    uuid: userUuid,
    timestamp: ts,
  });
  const assistantLine = JSON.stringify({
    parentUuid: userUuid,
    isSidechain: false,
    userType: 'external',
    cwd: '/test/project',
    sessionId,
    version: '2.0.9',
    gitBranch,
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5',
      role: 'assistant',
      content: [{ type: 'text', text: `Answer about ${topic}` }],
    },
    uuid: assistantUuid,
    timestamp: ts,
  });
  return userLine + '\n' + assistantLine + '\n';
}

describe('search metadata filters', () => {
  let testDir: string;
  let projectsDir: string;
  let archiveDir: string;
  let configDir: string;
  let dbPath: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'em-meta-test-'));
    projectsDir = join(testDir, 'projects');
    archiveDir = join(testDir, 'archive');
    configDir = join(testDir, 'config');
    dbPath = join(testDir, 'test.db');
    mkdirSync(projectsDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });

    process.env.TEST_PROJECTS_DIR = projectsDir;
    process.env.TEST_ARCHIVE_DIR = archiveDir;
    process.env.EPISODIC_MEMORY_CONFIG_DIR = configDir;
    process.env.TEST_DB_PATH = dbPath;
    restoreConsole = suppressConsole();

    // Seed: two projects with distinct sessions and branches discussing
    // overlapping topics.
    const projectA = join(projectsDir, 'project-a');
    const projectB = join(projectsDir, 'project-b');
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    writeFileSync(
      join(projectA, 'session-1.jsonl'),
      makeExchangeLines({ seq: 1, sessionId: 'session-1', gitBranch: 'main', topic: 'authentication' }),
      'utf-8'
    );
    writeFileSync(
      join(projectA, 'session-2.jsonl'),
      makeExchangeLines({ seq: 2, sessionId: 'session-2', gitBranch: 'feature-x', topic: 'authentication' }),
      'utf-8'
    );
    writeFileSync(
      join(projectB, 'session-3.jsonl'),
      makeExchangeLines({ seq: 3, sessionId: 'session-3', gitBranch: 'main', topic: 'authentication' }),
      'utf-8'
    );

    await indexUnprocessed(1, true);
  });

  afterEach(() => {
    restoreConsole();
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.TEST_ARCHIVE_DIR;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    delete process.env.TEST_DB_PATH;
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('filters search results by project name (exact match)', async () => {
    const results = await searchConversations('authentication', { project: 'project-a', mode: 'vector', limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.exchange.project).toBe('project-a');
    }
  });

  it('returns no results when project filter matches nothing', async () => {
    const results = await searchConversations('authentication', { project: 'project-nonexistent', mode: 'vector', limit: 10 });
    expect(results).toEqual([]);
  });

  it('filters by session_id (exact match)', async () => {
    const results = await searchConversations('authentication', { session_id: 'session-2', mode: 'text', limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    // session-2 is in project-a only, so all archive paths point there
    for (const r of results) {
      expect(r.exchange.archivePath).toContain('project-a');
      expect(r.exchange.archivePath).toContain('session-2');
    }
  });

  it('filters by git_branch (exact match)', async () => {
    const results = await searchConversations('authentication', { git_branch: 'feature-x', mode: 'vector', limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    // feature-x only exists on session-2 in project-a
    for (const r of results) {
      expect(r.exchange.archivePath).toContain('session-2');
    }
  });

  it('combines metadata filters with AND semantics', async () => {
    // project-a + main matches session-1 only
    const results = await searchConversations('authentication', {
      project: 'project-a',
      git_branch: 'main',
      mode: 'vector',
      limit: 10,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.exchange.archivePath).toContain('session-1');
    }
  });

  it('rejects a single-quote in a filter value (no string-interpolation injection)', async () => {
    // With string interpolation this would either error with a SQL syntax issue
    // or, worse, succeed in injecting. With bound parameters it just doesn't match.
    const results = await searchConversations('authentication', {
      project: "project-a' OR '1'='1",
      mode: 'text',
      limit: 10,
    });
    expect(results).toEqual([]);
  });

  it('does not regress unfiltered search (returns all matching projects)', async () => {
    const results = await searchConversations('authentication', { mode: 'text', limit: 10 });
    const projects = new Set(results.map(r => r.exchange.project));
    expect(projects.has('project-a')).toBe(true);
    expect(projects.has('project-b')).toBe(true);
  });
});
