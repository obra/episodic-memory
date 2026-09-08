import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { syncConversations } from '../src/sync.js';
import { indexConversations, indexUnprocessed, indexSession } from '../src/indexer.js';
import { verifyIndex } from '../src/verify.js';
import { statIfExists } from '../src/paths.js';
import { suppressConsole } from './test-utils.js';

// Symlink creation is unavailable in some environments (e.g. Windows without
// Developer Mode). Probe once and skip the whole suite when unsupported.
let symlinksSupported = true;
{
  const probeDir = mkdtempSync(join(tmpdir(), 'em-symlink-probe-'));
  try {
    symlinkSync(join(probeDir, 'no-such-target'), join(probeDir, 'probe'));
  } catch {
    symlinksSupported = false;
  }
  rmSync(probeDir, { recursive: true, force: true });
}

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

describe.skipIf(!symlinksSupported)('directory walks survive dangling symlinks', () => {
  let testDir: string;
  let projectsDir: string;
  let archiveDir: string;
  let configDir: string;
  let dbPath: string;
  let restoreConsole: () => void;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-dangling-test-'));
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
  });

  afterEach(() => {
    restoreConsole();
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.TEST_ARCHIVE_DIR;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    delete process.env.TEST_DB_PATH;
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  /** A normal on-disk project with one parseable conversation. */
  function setupRealProject(sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'): void {
    const projectDir = join(projectsDir, '-Users-real-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), makeExchangeLines(1, sessionId), 'utf-8');
  }

  /** A symlink whose target no longer exists — what a storage migration leaves behind. */
  function addDanglingSymlink(parentDir: string): void {
    symlinkSync(join(testDir, 'no-such-target'), join(parentDir, '-Users-migrated-away'));
  }

  function indexedArchivePaths(): string[] {
    const db = new Database(dbPath);
    const rows = db.prepare('SELECT DISTINCT archive_path FROM exchanges').all() as Array<{ archive_path: string }>;
    db.close();
    return rows.map(r => r.archive_path);
  }

  it('sync copies real and valid-symlinked projects and skips the dangling entry', async () => {
    setupRealProject();

    // A project reachable only through a healthy symlink must still sync —
    // the fix has to skip dangling links without breaking valid ones.
    const movedProject = join(testDir, 'moved-project');
    mkdirSync(movedProject, { recursive: true });
    writeFileSync(
      join(movedProject, 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff.jsonl'),
      makeExchangeLines(2, 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'),
      'utf-8'
    );
    symlinkSync(movedProject, join(projectsDir, '-Users-valid-link'));

    addDanglingSymlink(projectsDir);

    const result = await syncConversations(projectsDir, archiveDir, { skipIndex: true, skipSummaries: true });

    expect(result.copied).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('indexConversations indexes the real project despite a dangling sibling', async () => {
    setupRealProject();
    addDanglingSymlink(projectsDir);

    await indexConversations(undefined, undefined, 1, true);

    const paths = indexedArchivePaths();
    expect(paths.some(p => p.includes('-Users-real-project'))).toBe(true);
  });

  it('indexUnprocessed indexes the real project despite a dangling sibling', async () => {
    setupRealProject();
    addDanglingSymlink(projectsDir);

    await indexUnprocessed(1, true);

    const paths = indexedArchivePaths();
    expect(paths.some(p => p.includes('-Users-real-project'))).toBe(true);
  });

  it('indexSession completes a not-found scan without aborting', async () => {
    setupRealProject();
    addDanglingSymlink(projectsDir);

    await expect(
      indexSession('ffffffff-0000-0000-0000-000000000000', 1, true)
    ).resolves.toBeUndefined();
  });

  it('verifyIndex walks an archive containing a dangling symlink', async () => {
    const archiveProject = join(archiveDir, '-Users-real-project');
    mkdirSync(archiveProject, { recursive: true });
    writeFileSync(
      join(archiveProject, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'),
      makeExchangeLines(1, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
      'utf-8'
    );
    addDanglingSymlink(archiveDir);

    const result = await verifyIndex();

    // The walk must reach the real project (its conversation has no summary yet).
    expect(result.missing.length).toBe(1);
  });
});

describe.skipIf(!symlinksSupported)('statIfExists', () => {
  it('follows valid symlinks and returns null for dangling ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'em-statifexists-'));
    try {
      const realDir = join(dir, 'real');
      mkdirSync(realDir);
      symlinkSync(realDir, join(dir, 'valid-link'));
      symlinkSync(join(dir, 'no-such-target'), join(dir, 'dangling-link'));

      expect(statIfExists(realDir)?.isDirectory()).toBe(true);
      expect(statIfExists(join(dir, 'valid-link'))?.isDirectory()).toBe(true);
      expect(statIfExists(join(dir, 'dangling-link'))).toBeNull();
      expect(statIfExists(join(dir, 'never-existed'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
