import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, utimesSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { syncConversations } from '../src/sync.js';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

describe('sync command', () => {
  let testDir: string;
  let sourceDir: string;
  let destDir: string;
  let dbPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-sync-test-'));
    sourceDir = join(testDir, 'source');
    destDir = join(testDir, 'dest');
    dbPath = join(testDir, 'test.db');

    // Create source directory
    mkdirSync(sourceDir, { recursive: true });

    // Isolate from the user's real exclude.txt / config so subagents/ dirs
    // aren't pre-filtered at discovery.
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir, 'config');
    mkdirSync(process.env.EPISODIC_MEMORY_CONFIG_DIR, { recursive: true });

    // Set DB path for sync to use
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should copy new files from source to destination', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const testFile = join(sourceDir, 'project-a', 'test.jsonl');
    writeFileSync(testFile, 'test content', 'utf-8');

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(0);

    // Verify file was copied
    const destFile = join(destDir, 'project-a', 'test.jsonl');
    expect(statSync(destFile).isFile()).toBe(true);
  });

  it('should skip files that have not been modified', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const testFile = join(sourceDir, 'project-a', 'test.jsonl');
    writeFileSync(testFile, 'test content', 'utf-8');

    // First sync - should copy
    await syncConversations(sourceDir, destDir, { skipIndex: true });

    // Second sync - should skip (same mtime)
    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should copy files that were modified after previous sync', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const testFile = join(sourceDir, 'project-a', 'test.jsonl');
    writeFileSync(testFile, 'version 1', 'utf-8');

    // First sync
    await syncConversations(sourceDir, destDir, { skipIndex: true });

    // Modify source file (update mtime)
    const now = new Date();
    const future = new Date(now.getTime() + 5000);
    writeFileSync(testFile, 'version 2', 'utf-8');
    utimesSync(testFile, future, future);

    // Second sync - should copy updated file
    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('should handle multiple projects', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    mkdirSync(join(sourceDir, 'project-b'), { recursive: true });
    mkdirSync(join(sourceDir, 'project-c'), { recursive: true });
    writeFileSync(join(sourceDir, 'project-a', 'test1.jsonl'), 'content 1', 'utf-8');
    writeFileSync(join(sourceDir, 'project-b', 'test2.jsonl'), 'content 2', 'utf-8');
    writeFileSync(join(sourceDir, 'project-c', 'test3.jsonl'), 'content 3', 'utf-8');

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(3);
    expect(result.skipped).toBe(0);
  });

  it('should only sync jsonl files', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    writeFileSync(join(sourceDir, 'project-a', 'test.jsonl'), 'good', 'utf-8');
    writeFileSync(join(sourceDir, 'project-a', 'test.txt'), 'bad', 'utf-8');
    writeFileSync(join(sourceDir, 'project-a', 'test.json'), 'bad', 'utf-8');

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(1);
  });

  it('should skip excluded projects', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    mkdirSync(join(sourceDir, 'project-b'), { recursive: true });
    writeFileSync(join(sourceDir, 'project-a', 'test1.jsonl'), 'content', 'utf-8');
    writeFileSync(join(sourceDir, 'project-b', 'test2.jsonl'), 'content', 'utf-8');

    process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS = 'project-a';
    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });
    delete process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS;

    expect(result.copied).toBe(1);
    expect(existsSync(join(destDir, 'project-a'))).toBe(false);
    expect(existsSync(join(destDir, 'project-b', 'test2.jsonl'))).toBe(true);
  });

  it('should skip indexing conversations with DO NOT INDEX marker', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });

    // Create conversation WITH marker
    const markedConversation = JSON.stringify({
      type: 'user',
      uuid: 'uuid-1',
      parentUuid: null,
      timestamp: '2025-10-01T12:00:00Z',
      isSidechain: false,
      message: {
        role: 'user',
        content: '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>\nSummarize this conversation...'
      }
    }) + '\n' + JSON.stringify({
      type: 'assistant',
      uuid: 'uuid-2',
      parentUuid: 'uuid-1',
      timestamp: '2025-10-01T12:00:01Z',
      isSidechain: false,
      message: { role: 'assistant', content: 'Summary of conversation' }
    });

    // Create conversation WITHOUT marker
    const normalConversation = JSON.stringify({
      type: 'user',
      uuid: 'uuid-3',
      parentUuid: null,
      timestamp: '2025-10-01T13:00:00Z',
      isSidechain: false,
      message: { role: 'user', content: 'Normal question' }
    }) + '\n' + JSON.stringify({
      type: 'assistant',
      uuid: 'uuid-4',
      parentUuid: 'uuid-3',
      timestamp: '2025-10-01T13:00:01Z',
      isSidechain: false,
      message: { role: 'assistant', content: 'Normal answer' }
    });

    writeFileSync(join(sourceDir, 'project-a', 'marked.jsonl'), markedConversation, 'utf-8');
    writeFileSync(join(sourceDir, 'project-a', 'normal.jsonl'), normalConversation, 'utf-8');

    // Initialize test database
    const db = new Database(dbPath);
    sqliteVec.load(db);
    db.exec(`
      CREATE TABLE exchanges (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        user_message TEXT NOT NULL,
        assistant_message TEXT NOT NULL,
        archive_path TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        last_indexed INTEGER
      )
    `);
    db.exec(`
      CREATE VIRTUAL TABLE vec_exchanges USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[384]
      )
    `);
    db.close();

    // Sync with indexing enabled
    const result = await syncConversations(sourceDir, destDir);

    // Both files should be copied
    expect(result.copied).toBe(2);

    // But only normal conversation should be indexed
    expect(result.indexed).toBe(1);

    // Verify in database
    const dbCheck = new Database(dbPath, { readonly: true });
    const count = dbCheck.prepare('SELECT COUNT(*) as count FROM exchanges').get() as { count: number };
    dbCheck.close();

    expect(count.count).toBe(1); // Only normal conversation indexed
  });

  it('writes an empty summary sentinel for zero-exchange files so they do not re-queue forever', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });

    // Stage more than summaryLimit (default 10) zero-exchange files — file-history-snapshot is a metadata record the parser drops.
    const zeroExchangeFileCount = 12;
    for (let i = 0; i < zeroExchangeFileCount; i++) {
      const id = `1111aaaa-1111-1111-1111-${String(i).padStart(12, '0')}`;
      const content = JSON.stringify({
        type: 'file-history-snapshot',
        sessionId: id,
        uuid: `meta-${i}`,
        timestamp: '2025-10-01T12:00:00Z'
      });
      writeFileSync(join(sourceDir, 'project-a', `${id}.jsonl`), content, 'utf-8');
    }

    // First sync: sentinel up to summaryLimit (default 10).
    const r1 = await syncConversations(sourceDir, destDir, { skipIndex: true });
    expect(r1.copied).toBe(zeroExchangeFileCount);
    expect(r1.summarized).toBe(0);

    const sentinelsAfter1 = readdirSync(join(destDir, 'project-a'))
      .filter(f => f.endsWith('-summary.txt'));
    expect(sentinelsAfter1.length).toBeGreaterThanOrEqual(10);

    // Sentinels must be empty — that's how future syncs know to skip the file.
    for (const s of sentinelsAfter1) {
      expect(statSync(join(destDir, 'project-a', s)).size).toBe(0);
    }

    // Second sync drains the rest. Before the fix the same 10 would re-queue forever.
    const r2 = await syncConversations(sourceDir, destDir, { skipIndex: true });
    expect(r2.summarized).toBe(0);

    const sentinelsAfter2 = readdirSync(join(destDir, 'project-a'))
      .filter(f => f.endsWith('-summary.txt'));
    expect(sentinelsAfter2.length).toBe(zeroExchangeFileCount);
  });

  it('should not copy sidechain files (top-level Warmup stub)', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const sidechainFile = join(sourceDir, 'project-a', 'agent-a01.jsonl');
    writeFileSync(
      sidechainFile,
      JSON.stringify({
        isSidechain: true,
        type: 'user',
        message: { role: 'user', content: 'Warmup' },
        uuid: 'warmup-1',
        timestamp: '2026-01-01T00:00:00.000Z',
      }) + '\n',
      'utf-8'
    );

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true, skipSummaries: true });

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(existsSync(join(destDir, 'project-a', 'agent-a01.jsonl'))).toBe(false);
  });

  it('should not copy sidechain files (nested subagent dispatch)', async () => {
    mkdirSync(join(sourceDir, 'project-a', 'parent-session', 'subagents'), { recursive: true });
    const sidechainFile = join(sourceDir, 'project-a', 'parent-session', 'subagents', 'agent-a01.jsonl');
    writeFileSync(
      sidechainFile,
      JSON.stringify({
        isSidechain: true,
        type: 'user',
        cwd: '/test/project',
        message: { role: 'user', content: 'Investigate the bug' },
        uuid: 'sub-1',
        timestamp: '2026-01-01T00:00:00.000Z',
      }) + '\n' +
      JSON.stringify({
        isSidechain: true,
        type: 'assistant',
        cwd: '/test/project',
        message: { role: 'assistant', content: 'Found it in foo.ts' },
        uuid: 'sub-2',
        timestamp: '2026-01-01T00:00:01.000Z',
      }) + '\n',
      'utf-8'
    );

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true, skipSummaries: true });

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(existsSync(join(destDir, 'project-a', 'parent-session', 'subagents', 'agent-a01.jsonl'))).toBe(false);
  });

  it('should copy regular non-sidechain conversation files', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const regularFile = join(sourceDir, 'project-a', 'session-1.jsonl');
    writeFileSync(
      regularFile,
      JSON.stringify({
        isSidechain: false,
        type: 'user',
        cwd: '/test/project',
        message: { role: 'user', content: 'Hello' },
        uuid: 'reg-1',
        timestamp: '2026-01-01T00:00:00.000Z',
      }) + '\n',
      'utf-8'
    );

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true, skipSummaries: true });

    expect(result.copied).toBe(1);
    expect(existsSync(join(destDir, 'project-a', 'session-1.jsonl'))).toBe(true);
  });

  it('does not index inline sidechain exchanges from a mixed file', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });

    // A regular session (first record non-sidechain, so the file is copied)
    // that also carries inline sidechain exchanges — the case the per-exchange
    // filter must catch on the sync indexing path, not just the manual reindex.
    const rec = (uuid: string, parent: string | null, role: string, text: string, isSidechain: boolean) =>
      JSON.stringify({
        parentUuid: parent,
        isSidechain,
        userType: 'external',
        cwd: '/test/project',
        sessionId: 'mix-1',
        version: '2.0.9',
        gitBranch: 'main',
        type: role,
        message:
          role === 'user'
            ? { role: 'user', content: text }
            : { model: 'claude-sonnet-4-5', role: 'assistant', content: [{ type: 'text', text }] },
        uuid,
        timestamp: '2026-01-01T00:00:00.000Z',
      });

    const mixed = [
      rec('m-u1', null, 'user', 'Real question about the indexer', false),
      rec('m-a1', 'm-u1', 'assistant', 'Real answer about the indexer', false),
      rec('m-u2', 'm-a1', 'user', 'Subagent internal step', true),
      rec('m-a2', 'm-u2', 'assistant', 'Subagent internal finding', true),
    ].join('\n') + '\n';
    writeFileSync(join(sourceDir, 'project-a', 'mix-1.jsonl'), mixed, 'utf-8');

    const result = await syncConversations(sourceDir, destDir, { skipSummaries: true });

    // File is copied (its first record is non-sidechain) and indexed...
    expect(result.copied).toBe(1);
    expect(result.indexed).toBe(1);

    // ...but only the non-sidechain exchange lands in the DB.
    const db = new Database(dbPath, { readonly: true });
    const total = (db.prepare('SELECT COUNT(*) AS c FROM exchanges').get() as { c: number }).c;
    const sidechain = (db.prepare('SELECT COUNT(*) AS c FROM exchanges WHERE is_sidechain = 1').get() as { c: number }).c;
    db.close();

    expect(total).toBe(1);
    expect(sidechain).toBe(0);
  });

  it('skips a sidechain file whose first record is larger than the read chunk', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });

    // A subagent dispatch whose opening record (big prompt + attachments) is
    // larger than the chunk size — the file-level peek must read the whole
    // record to see isSidechain rather than truncating and copying it.
    const bigPrompt = 'x'.repeat(40000);
    const sidechainFile = join(sourceDir, 'project-a', 'agent-big01.jsonl');
    writeFileSync(
      sidechainFile,
      JSON.stringify({
        isSidechain: true,
        type: 'user',
        cwd: '/test/project',
        message: { role: 'user', content: bigPrompt },
        uuid: 'big-1',
        timestamp: '2026-01-01T00:00:00.000Z',
      }) + '\n' +
      JSON.stringify({
        isSidechain: true,
        type: 'assistant',
        cwd: '/test/project',
        message: { role: 'assistant', content: 'done' },
        uuid: 'big-2',
        timestamp: '2026-01-01T00:00:01.000Z',
      }) + '\n',
      'utf-8'
    );

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true, skipSummaries: true });

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(existsSync(join(destDir, 'project-a', 'agent-big01.jsonl'))).toBe(false);
  });
});
