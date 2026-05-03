import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { indexUnprocessed } from '../src/indexer.js';
import { syncConversations } from '../src/sync.js';
import { suppressConsole } from './test-utils.js';

/**
 * Synthesize one user/assistant exchange's worth of JSONL lines.
 * Same shape as Claude Code transcripts so the parser accepts them.
 */
function makeExchangeLines(seq: number, sessionId: string): string {
  const userUuid = `user-${seq}-${sessionId}`;
  const assistantUuid = `asst-${seq}-${sessionId}`;
  const ts = new Date(2026, 0, 1 + seq).toISOString();
  const userLine = JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: '/test/project',
    sessionId,
    version: '2.0.9',
    gitBranch: 'main',
    type: 'user',
    message: { role: 'user', content: `User question ${seq} in session ${sessionId}` },
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
      content: [{ type: 'text', text: `Reply ${seq} in session ${sessionId}` }],
    },
    uuid: assistantUuid,
    timestamp: ts,
  });
  return userLine + '\n' + assistantLine + '\n';
}

describe('exclude.txt applies to nested directories (#80)', () => {
  let testDir: string;
  let projectsDir: string;
  let archiveDir: string;
  let configDir: string;
  let dbPath: string;
  let restoreConsole: () => void;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-exclude-test-'));
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
    process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS = 'subagents';
    restoreConsole = suppressConsole();
  });

  afterEach(() => {
    restoreConsole();
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.TEST_ARCHIVE_DIR;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    delete process.env.TEST_DB_PATH;
    delete process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS;
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  function setupProjectWithNestedSubagents(): { mainPath: string; subagentPath: string } {
    const projectDir = join(projectsDir, 'project-a');
    const sessionDir = join(projectDir, 'session-uuid');
    const subagentDir = join(sessionDir, 'subagents');
    mkdirSync(subagentDir, { recursive: true });

    const mainPath = join(projectDir, 'main.jsonl');
    const subagentPath = join(subagentDir, 'agent-1.jsonl');
    writeFileSync(mainPath, makeExchangeLines(1, 'main-session'), 'utf-8');
    writeFileSync(subagentPath, makeExchangeLines(2, 'agent-1-session'), 'utf-8');
    return { mainPath, subagentPath };
  }

  function indexedArchivePaths(): string[] {
    const db = new Database(dbPath);
    const rows = db.prepare('SELECT DISTINCT archive_path FROM exchanges').all() as Array<{ archive_path: string }>;
    db.close();
    return rows.map(r => r.archive_path);
  }

  it('indexer skips JSONL files under a nested directory whose name is in exclude.txt', async () => {
    setupProjectWithNestedSubagents();

    await indexUnprocessed(1, true);

    const paths = indexedArchivePaths();
    expect(paths.some(p => p.includes('main.jsonl'))).toBe(true);
    expect(paths.some(p => p.includes('subagents'))).toBe(false);
  });

  it('sync skips JSONL files under a nested excluded directory', async () => {
    setupProjectWithNestedSubagents();

    const result = await syncConversations(projectsDir, archiveDir, { skipIndex: true });

    // Only the main.jsonl should be copied; the subagent file is excluded.
    expect(result.copied).toBe(1);
  });
});
