import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, utimesSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { syncConversations } from '../src/sync.js';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

// Minimal valid Claude transcript line — sync skips message-less files
// (summarizer-stub filtering), so fixtures need at least one message.
function transcriptContent(text = 'hello'): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
}

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

    // Set DB path for sync to use
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should copy new files from source to destination', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const testFile = join(sourceDir, 'project-a', 'test.jsonl');
    writeFileSync(testFile, transcriptContent(), 'utf-8');

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
    writeFileSync(testFile, transcriptContent(), 'utf-8');

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
    writeFileSync(testFile, transcriptContent('version 1'), 'utf-8');

    // First sync
    await syncConversations(sourceDir, destDir, { skipIndex: true });

    // Modify source file (update mtime)
    const now = new Date();
    const future = new Date(now.getTime() + 5000);
    writeFileSync(testFile, transcriptContent('version 2'), 'utf-8');
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
    writeFileSync(join(sourceDir, 'project-a', 'test1.jsonl'), transcriptContent('content 1'), 'utf-8');
    writeFileSync(join(sourceDir, 'project-b', 'test2.jsonl'), transcriptContent('content 2'), 'utf-8');
    writeFileSync(join(sourceDir, 'project-c', 'test3.jsonl'), transcriptContent('content 3'), 'utf-8');

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(3);
    expect(result.skipped).toBe(0);
  });

  it('should only sync jsonl files', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    writeFileSync(join(sourceDir, 'project-a', 'test.jsonl'), transcriptContent('good'), 'utf-8');
    writeFileSync(join(sourceDir, 'project-a', 'test.txt'), 'bad', 'utf-8');
    writeFileSync(join(sourceDir, 'project-a', 'test.json'), 'bad', 'utf-8');

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(1);
  });

  it('should skip excluded projects', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    mkdirSync(join(sourceDir, 'project-b'), { recursive: true });
    writeFileSync(join(sourceDir, 'project-a', 'test1.jsonl'), transcriptContent(), 'utf-8');
    writeFileSync(join(sourceDir, 'project-b', 'test2.jsonl'), transcriptContent(), 'utf-8');

    process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS = 'project-a';
    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });
    delete process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS;

    expect(result.copied).toBe(1);
    expect(existsSync(join(destDir, 'project-a'))).toBe(false);
    expect(existsSync(join(destDir, 'project-b', 'test2.jsonl'))).toBe(true);
  });

  it('skips message-less transcripts (summarizer-spawned ai-title stubs)', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    writeFileSync(
      join(sourceDir, 'project-a', 'stub.jsonl'),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Summarize conversation X', sessionId: 'abc' }) + '\n',
      'utf-8'
    );
    writeFileSync(join(sourceDir, 'project-a', 'real.jsonl'), transcriptContent(), 'utf-8');

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(1);
    expect(existsSync(join(destDir, 'project-a', 'stub.jsonl'))).toBe(false);
    expect(existsSync(join(destDir, 'project-a', 'real.jsonl'))).toBe(true);
  });

  it('queues summaries for transcripts whose filename has no UUID (subagent transcripts)', async () => {
    // Subagent transcripts are named agent-<hex>.jsonl — no UUID to extract.
    // Before the fix, the missing-sessionId gate dropped them from the summary
    // queue entirely. Use a zero-exchange transcript (a lone user message): if
    // it reaches the summary pipeline it gets an empty sentinel written — which
    // is observable without any network/CLI call. No sentinel ⇒ it was dropped.
    mkdirSync(join(sourceDir, 'project-a', 'session-1', 'subagents'), { recursive: true });
    const subagentFile = join(sourceDir, 'project-a', 'session-1', 'subagents', 'agent-a81c86e504e1e7c14.jsonl');
    writeFileSync(
      subagentFile,
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'unanswered subagent prompt' } }),
      'utf-8'
    );

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(1);
    const sentinel = join(destDir, 'project-a', 'session-1', 'subagents', 'agent-a81c86e504e1e7c14-summary.txt');
    expect(existsSync(sentinel)).toBe(true);
    expect(statSync(sentinel).size).toBe(0);
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

    // Stage more than summaryLimit (default 10) zero-exchange files — a lone
    // user message with no assistant reply parses to zero exchanges (it has
    // message content, so it passes the message-less stub filter and reaches
    // the sentinel path).
    const zeroExchangeFileCount = 12;
    for (let i = 0; i < zeroExchangeFileCount; i++) {
      const id = `1111aaaa-1111-1111-1111-${String(i).padStart(12, '0')}`;
      const content = JSON.stringify({
        type: 'user',
        sessionId: id,
        uuid: `meta-${i}`,
        timestamp: '2025-10-01T12:00:00Z',
        message: { role: 'user', content: 'unanswered question' }
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
});
