import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { indexUnprocessed } from '../src/indexer.js';
import { searchConversations } from '../src/search.js';
import { suppressConsole } from './test-utils.js';

/**
 * Build one user/assistant exchange. `isSidechain` controls whether it is a
 * subagent dispatch (excluded from search results by `is_sidechain = 0`). The
 * exchange text embeds `topic` so semantic queries can rank it.
 */
function makeExchangeLines(opts: {
  seq: number;
  sessionId: string;
  topic: string;
  isSidechain: boolean;
}): string {
  const { seq, sessionId, topic, isSidechain } = opts;
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
    message: { role: 'user', content: `Question about ${topic}` },
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
      content: [{ type: 'text', text: `Answer about ${topic}` }],
    },
    uuid: assistantUuid,
    timestamp: ts,
  });
  return userLine + '\n' + assistantLine + '\n';
}

describe('vector search recall vs sidechain crowding', () => {
  let testDir: string;
  let projectsDir: string;
  let archiveDir: string;
  let configDir: string;
  let dbPath: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'em-sidechain-test-'));
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

    const project = join(projectsDir, 'project-a');
    mkdirSync(project, { recursive: true });

    // The single real (non-sidechain) exchange the user wants to find. It is on
    // the same concept as the query but phrased differently, so it ranks just
    // below the sidechains that match the query wording exactly.
    writeFileSync(
      join(project, 'real-session.jsonl'),
      makeExchangeLines({
        seq: 1,
        sessionId: 'real-session',
        topic: 'rolling out containerized services to a managed orchestration cluster',
        isSidechain: false,
      }),
      'utf-8'
    );

    // Many subagent (sidechain) exchanges whose text matches the query wording
    // exactly, so they are the nearest neighbours. Because vec0 applies the `k`
    // cutoff before `is_sidechain = 0`, with `k = limit` the top-`limit` slots
    // are all these sidechains and the real exchange gets filtered out, yielding
    // zero results.
    for (let i = 0; i < 20; i++) {
      writeFileSync(
        join(project, `agent-${i}.jsonl`),
        makeExchangeLines({ seq: 10 + i, sessionId: `agent-${i}`, topic: 'kubernetes deployment', isSidechain: true }),
        'utf-8'
      );
    }

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

  it('returns the real exchange at a small limit despite many sidechain neighbours', async () => {
    const results = await searchConversations('kubernetes deployment', { mode: 'vector', limit: 3 });
    expect(results.length).toBe(1);
    for (const r of results) {
      expect(r.exchange.isSidechain).toBe(false);
    }
  });

  it('never returns sidechain exchanges from vector search', async () => {
    const results = await searchConversations('kubernetes deployment', { mode: 'vector', limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.exchange.isSidechain).toBe(false);
    }
  });
});
