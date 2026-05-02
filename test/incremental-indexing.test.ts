import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { indexUnprocessed } from '../src/indexer.js';
import { suppressConsole } from './test-utils.js';

/**
 * Synthesize one user/assistant exchange's worth of JSONL lines.
 * Matches the shape produced by Claude Code transcripts well enough for
 * the parser, but with a unique sessionId/text per call so embeddings differ.
 */
function makeExchangeLines(seq: number, sessionId: string): string {
  const userUuid = `user-${seq}-${sessionId}`;
  const assistantUuid = `asst-${seq}-${sessionId}`;
  const ts = new Date(2026, 0, 1 + seq).toISOString();
  const userLine = JSON.stringify({
    parentUuid: seq === 1 ? null : `asst-${seq - 1}-${sessionId}`,
    isSidechain: false,
    userType: 'external',
    cwd: '/test/project',
    sessionId,
    version: '2.0.9',
    gitBranch: 'main',
    type: 'user',
    message: { role: 'user', content: `User question number ${seq} about topic-${seq}` },
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
    gitBranch: 'main',
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5',
      role: 'assistant',
      content: [{ type: 'text', text: `Assistant answer ${seq} discussing details of topic-${seq}` }],
    },
    uuid: assistantUuid,
    timestamp: ts,
  });
  return userLine + '\n' + assistantLine + '\n';
}

describe('indexer: incremental indexing', () => {
  let testDir: string;
  let projectsDir: string;
  let configDir: string;
  let dbPath: string;
  let restoreConsole: () => void;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-incr-test-'));
    projectsDir = join(testDir, 'projects');
    configDir = join(testDir, 'config');
    dbPath = join(testDir, 'test.db');
    mkdirSync(projectsDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });

    process.env.TEST_PROJECTS_DIR = projectsDir;
    process.env.EPISODIC_MEMORY_CONFIG_DIR = configDir;
    process.env.TEST_DB_PATH = dbPath;
    restoreConsole = suppressConsole();
  });

  afterEach(() => {
    restoreConsole();
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    delete process.env.TEST_DB_PATH;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  function countExchanges(): number {
    const db = new Database(dbPath);
    const row = db.prepare('SELECT COUNT(*) AS c FROM exchanges').get() as { c: number };
    db.close();
    return row.c;
  }

  it('indexes new exchanges appended to a previously-indexed transcript', async () => {
    const projectDir = join(projectsDir, 'project-a');
    mkdirSync(projectDir, { recursive: true });
    const transcriptPath = join(projectDir, 'session-1.jsonl');

    // First pass: write 2 exchanges, index, expect 2 in DB
    writeFileSync(transcriptPath, makeExchangeLines(1, 'session-1') + makeExchangeLines(2, 'session-1'), 'utf-8');
    await indexUnprocessed(1, true);
    expect(countExchanges()).toBe(2);

    // Append 3 more exchanges, re-index, expect 5 total
    appendFileSync(
      transcriptPath,
      makeExchangeLines(3, 'session-1') + makeExchangeLines(4, 'session-1') + makeExchangeLines(5, 'session-1'),
      'utf-8'
    );
    await indexUnprocessed(1, true);
    expect(countExchanges()).toBe(5);
  });
});
