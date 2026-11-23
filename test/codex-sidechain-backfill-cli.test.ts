import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC_CLI = join(REPO_ROOT, 'dist', 'sync-cli.js');
const CHILD_THREAD_ID = '019e4c75-0000-7000-8000-000000000002';
const PARENT_THREAD_ID = '019e4c75-0000-7000-8000-000000000001';

describe('sync-cli Codex sidechain backfill', () => {
  let testDir: string;
  let dbPath: string;
  let env: NodeJS.ProcessEnv;

  const runSync = (...args: string[]) => spawnSync(process.execPath, [SYNC_CLI, ...args], {
    env, timeout: 30000, encoding: 'utf-8'
  });
  const query = (sql: string) => {
    const db = new Database(dbPath, { readonly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  };
  const sidechainFlag = () => (query(`SELECT is_sidechain FROM exchanges WHERE id = 'legacy-row'`)[0] as { is_sidechain: number }).is_sidechain;
  const completed = () => query('SELECT name FROM completed_migrations');

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-codex-backfill-cli-'));
    const configDir = join(testDir, 'config');
    mkdirSync(join(testDir, 'projects'), { recursive: true });
    mkdirSync(configDir, { recursive: true });
    dbPath = join(testDir, 'index.sqlite');
    env = {
      ...process.env,
      TEST_PROJECTS_DIR: join(testDir, 'projects'),
      TEST_ARCHIVE_DIR: join(testDir, 'archive'),
      EPISODIC_MEMORY_DB_PATH: dbPath,
      EPISODIC_MEMORY_CONFIG_DIR: configDir,
      EPISODIC_MEMORY_OPENCODE_DB_PATH: join(testDir, 'missing-opencode.db'),
      EPISODIC_MEMORY_SKIP_SUMMARIES: '1',
      EPISODIC_MEMORY_DISABLE_AUTO_SYNC: undefined,
      EPISODIC_MEMORY_SUMMARIZER_GUARD: undefined
    };

    const rolloutPath = join(testDir, `rollout-2026-05-12T18-00-00-${CHILD_THREAD_ID}.jsonl`);
    writeFileSync(rolloutPath, JSON.stringify({
      type: 'session_meta',
      payload: { id: CHILD_THREAD_ID, cwd: '/work/child-project', source: { subagent: 'review' } }
    }) + '\n');

    process.env.EPISODIC_MEMORY_DB_PATH = dbPath;
    const { initDatabase, insertExchange } = await import('../src/db.js');
    const db = initDatabase();
    insertExchange(db, {
      id: 'legacy-row', project: 'p', timestamp: '2026-05-12T18:00:06.000Z', userMessage: 'Q', assistantMessage: 'A',
      archivePath: rolloutPath, lineStart: 2, lineEnd: 3, harness: 'codex', sessionId: PARENT_THREAD_ID, isSidechain: false
    }, new Array(384).fill(0.1));
    db.close();
    delete process.env.EPISODIC_MEMORY_DB_PATH;
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('skips the backfill when --only excludes codex', () => {
    const result = runSync('--only', 'claude');

    expect(result.status).toBe(0);
    expect(sidechainFlag()).toBe(0);
    expect(completed()).toEqual([]);
  });

  it('runs once, then later syncs skip the completed backfill', () => {
    expect(runSync().status).toBe(0);
    expect(sidechainFlag()).toBe(1);
    expect(completed()).toEqual([{ name: 'codex-sidechain-backfill' }]);

    const db = new Database(dbPath);
    db.prepare(`UPDATE exchanges SET is_sidechain = 0 WHERE id = 'legacy-row'`).run();
    db.close();

    expect(runSync().status).toBe(0);
    expect(sidechainFlag()).toBe(0);
  });
});
