import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { indexUnprocessed } from '../src/indexer.js';
import { suppressConsole } from './test-utils.js';

function makeExchangeLines(seq: number, sessionId: string, isSidechain: boolean): string {
  const userUuid = `user-${seq}-${sessionId}`;
  const assistantUuid = `asst-${seq}-${sessionId}`;
  const ts = new Date(2026, 0, 1 + seq).toISOString();
  const userLine = JSON.stringify({
    parentUuid: seq === 1 ? null : `asst-${seq - 1}-${sessionId}`,
    isSidechain,
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
      content: [{ type: 'text', text: `Assistant answer ${seq} discussing details of topic-${seq}` }],
    },
    uuid: assistantUuid,
    timestamp: ts,
  });
  return userLine + '\n' + assistantLine + '\n';
}

describe('indexer: skip sidechain exchanges', () => {
  let testDir: string;
  let projectsDir: string;
  let configDir: string;
  let dbPath: string;
  let restoreConsole: () => void;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-sidechain-test-'));
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

  function countExchanges(): { total: number; sidechain: number } {
    const db = new Database(dbPath);
    const total = (db.prepare('SELECT COUNT(*) AS c FROM exchanges').get() as { c: number }).c;
    const sidechain = (db.prepare('SELECT COUNT(*) AS c FROM exchanges WHERE is_sidechain = 1').get() as { c: number }).c;
    db.close();
    return { total, sidechain };
  }

  it('does not insert sidechain exchanges into the DB', async () => {
    const projectDir = join(projectsDir, 'project-a');
    mkdirSync(projectDir, { recursive: true });

    // Mixed transcript: one non-sidechain exchange and one sidechain exchange.
    writeFileSync(
      join(projectDir, 'session-1.jsonl'),
      makeExchangeLines(1, 'session-1', false) + makeExchangeLines(2, 'session-1', true),
      'utf-8'
    );

    await indexUnprocessed(1, true);

    const { total, sidechain } = countExchanges();
    expect(total).toBe(1);
    expect(sidechain).toBe(0);
  });

  it('inserts nothing when every exchange is sidechain', async () => {
    const projectDir = join(projectsDir, 'project-a');
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, 'session-1.jsonl'),
      makeExchangeLines(1, 'session-1', true) + makeExchangeLines(2, 'session-1', true),
      'utf-8'
    );

    await indexUnprocessed(1, true);

    expect(countExchanges().total).toBe(0);
  });
});
