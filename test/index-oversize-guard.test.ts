import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

import {
  DEFAULT_MAX_MESSAGE_BYTES,
  getMaxMessageBytes,
  isOversizeExchange,
} from '../src/message-size.js';

// Mock the embedding backend so no model loads and calls are counted. sync.ts
// loads it via `await import('./embeddings.js')` and indexer.ts imports it
// statically; vi.mock intercepts both when registered before they are imported.
// vi.hoisted keeps embedSpy available inside the hoisted mock factory, which
// runs at indexer.ts's static import time.
const { embedSpy } = vi.hoisted(() => ({ embedSpy: vi.fn(async () => new Array(384).fill(0)) }));
vi.mock('../src/embeddings.js', () => ({
  initEmbeddings: vi.fn(async () => {}),
  generateExchangeEmbedding: embedSpy,
  generateQueryEmbedding: vi.fn(),
  generateEmbedding: vi.fn(),
  initEmbeddingsFailed: false,
}));

import { syncConversations } from '../src/sync.js';
import { indexUnprocessed } from '../src/indexer.js';

function userLine(seq: number, sessionId: string, text: string): string {
  return JSON.stringify({
    type: 'user',
    uuid: `user-${seq}-${sessionId}`,
    parentUuid: seq === 1 ? null : `asst-${seq - 1}-${sessionId}`,
    sessionId,
    isSidechain: false,
    timestamp: new Date(2026, 0, seq).toISOString(),
    message: { role: 'user', content: text },
  });
}

function assistantLine(seq: number, sessionId: string, text: string): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `asst-${seq}-${sessionId}`,
    parentUuid: `user-${seq}-${sessionId}`,
    sessionId,
    isSidechain: false,
    timestamp: new Date(2026, 0, seq).toISOString(),
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

function exchangeLines(seq: number, sessionId: string, userText: string): string {
  return userLine(seq, sessionId, userText) + '\n' +
    assistantLine(seq, sessionId, `answer ${seq}`) + '\n';
}

describe('message-size: policy unit', () => {
  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_MAX_MESSAGE_BYTES;
  });

  it('isOversizeExchange is true when userMessage exceeds the cap', () => {
    const exchange = { userMessage: 'x'.repeat(101), assistantMessage: 'ok' };
    expect(isOversizeExchange(exchange, 100)).toBe(true);
  });

  it('isOversizeExchange is true when assistantMessage exceeds the cap', () => {
    const exchange = { userMessage: 'hi', assistantMessage: 'y'.repeat(101) };
    expect(isOversizeExchange(exchange, 100)).toBe(true);
  });

  it('isOversizeExchange is false for a normal exchange under the cap', () => {
    const exchange = { userMessage: 'hi', assistantMessage: 'ok' };
    expect(isOversizeExchange(exchange, 100)).toBe(false);
  });

  it('counts UTF-8 bytes, not characters (multi-byte)', () => {
    // '🚀' is 4 UTF-8 bytes. 30 of them = 120 bytes > 100, but only 60 chars.
    const exchange = { userMessage: '🚀'.repeat(30), assistantMessage: 'ok' };
    expect(exchange.userMessage.length).toBeLessThanOrEqual(100); // char length is small
    expect(isOversizeExchange(exchange, 100)).toBe(true); // byte length is not
  });

  it('getMaxMessageBytes returns the default when unset', () => {
    delete process.env.EPISODIC_MEMORY_MAX_MESSAGE_BYTES;
    expect(getMaxMessageBytes({})).toBe(DEFAULT_MAX_MESSAGE_BYTES);
  });

  it('getMaxMessageBytes honors a valid positive override', () => {
    expect(getMaxMessageBytes({ EPISODIC_MEMORY_MAX_MESSAGE_BYTES: '4096' })).toBe(4096);
  });

  it('getMaxMessageBytes ignores invalid, zero, and negative overrides', () => {
    expect(getMaxMessageBytes({ EPISODIC_MEMORY_MAX_MESSAGE_BYTES: 'nonsense' })).toBe(DEFAULT_MAX_MESSAGE_BYTES);
    expect(getMaxMessageBytes({ EPISODIC_MEMORY_MAX_MESSAGE_BYTES: '0' })).toBe(DEFAULT_MAX_MESSAGE_BYTES);
    expect(getMaxMessageBytes({ EPISODIC_MEMORY_MAX_MESSAGE_BYTES: '-100' })).toBe(DEFAULT_MAX_MESSAGE_BYTES);
  });
});

describe('sync: oversize exchange guard (#139)', () => {
  let testDir: string;
  let sourceDir: string;
  let destDir: string;
  let dbPath: string;
  const sessionId = '019aff97-5651-71e0-80ec-b4f2c51095c3';
  const OVERSIZE_TEXT = 'x'.repeat(400 * 1024);

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-oversize-sync-'));
    sourceDir = join(testDir, 'source');
    destDir = join(testDir, 'dest');
    dbPath = join(testDir, 'test.db');
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    process.env.TEST_DB_PATH = dbPath;

    // One normal exchange, one whose USER message exceeds the default cap.
    const srcFile = join(sourceDir, 'project-a', `${sessionId}.jsonl`);
    writeFileSync(
      srcFile,
      exchangeLines(1, sessionId, 'a normal small question') +
        exchangeLines(2, sessionId, OVERSIZE_TEXT),
      'utf-8'
    );

    embedSpy.mockClear();
  });

  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    delete process.env.EPISODIC_MEMORY_MAX_MESSAGE_BYTES;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  function userMessages(): string[] {
    const db = new Database(dbPath);
    const rows = db.prepare('SELECT user_message FROM exchanges').all() as { user_message: string }[];
    db.close();
    return rows.map(r => r.user_message);
  }

  it('indexes the normal exchange, skips the oversize one before embedding, and logs the skip', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });

    try {
      const result = await syncConversations(sourceDir, destDir, { skipSummaries: true });
      expect(result.indexed).toBe(1);
    } finally {
      logSpy.mockRestore();
    }

    const msgs = userMessages();
    // Normal exchange present, oversize absent.
    expect(msgs.some(m => m.includes('a normal small question'))).toBe(true);
    expect(msgs.some(m => m.length > 300 * 1024)).toBe(false);
    expect(msgs.length).toBe(1);

    // Skip happened BEFORE embedding: only the normal exchange was embedded.
    expect(embedSpy).toHaveBeenCalledTimes(1);

    // A single log line reports the skip.
    expect(logs.some(l => /Skipped 1 oversize exchange/.test(l))).toBe(true);
  });

  it('honors a huge EPISODIC_MEMORY_MAX_MESSAGE_BYTES override (previously-oversize exchange now indexes)', async () => {
    process.env.EPISODIC_MEMORY_MAX_MESSAGE_BYTES = String(10 * 1024 * 1024);

    const result = await syncConversations(sourceDir, destDir, { skipSummaries: true });
    expect(result.indexed).toBe(1);

    const msgs = userMessages();
    expect(msgs.length).toBe(2);
    expect(msgs.some(m => m.length > 300 * 1024)).toBe(true);
    // Both exchanges embedded.
    expect(embedSpy).toHaveBeenCalledTimes(2);
  });

  it('honors a tiny EPISODIC_MEMORY_MAX_MESSAGE_BYTES override (even the normal exchange is skipped)', async () => {
    process.env.EPISODIC_MEMORY_MAX_MESSAGE_BYTES = '4';

    await syncConversations(sourceDir, destDir, { skipSummaries: true });

    expect(userMessages().length).toBe(0);
    expect(embedSpy).toHaveBeenCalledTimes(0);
  });
});

describe('indexer: oversize exchange guard via indexUnprocessed (#139)', () => {
  let testDir: string;
  let projectsDir: string;
  let configDir: string;
  let dbPath: string;
  const sessionId = 'session-oversize';
  const OVERSIZE_TEXT = 'x'.repeat(400 * 1024);

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-oversize-idx-'));
    projectsDir = join(testDir, 'projects');
    configDir = join(testDir, 'config');
    dbPath = join(testDir, 'test.db');
    mkdirSync(join(projectsDir, 'project-a'), { recursive: true });
    mkdirSync(configDir, { recursive: true });

    process.env.TEST_PROJECTS_DIR = projectsDir;
    process.env.EPISODIC_MEMORY_CONFIG_DIR = configDir;
    process.env.TEST_DB_PATH = dbPath;

    const transcriptPath = join(projectsDir, 'project-a', `${sessionId}.jsonl`);
    writeFileSync(
      transcriptPath,
      exchangeLines(1, sessionId, 'a normal small question') +
        exchangeLines(2, sessionId, OVERSIZE_TEXT),
      'utf-8'
    );

    embedSpy.mockClear();
  });

  afterEach(() => {
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    delete process.env.TEST_DB_PATH;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  function userMessages(): string[] {
    const db = new Database(dbPath);
    const rows = db.prepare('SELECT user_message FROM exchanges').all() as { user_message: string }[];
    db.close();
    return rows.map(r => r.user_message);
  }

  it('does not index or embed the oversize exchange through indexUnprocessed', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await indexUnprocessed(1, true);
    } finally {
      logSpy.mockRestore();
    }

    const msgs = userMessages();
    expect(msgs.length).toBe(1);
    expect(msgs.some(m => m.includes('a normal small question'))).toBe(true);
    expect(msgs.some(m => m.length > 300 * 1024)).toBe(false);
    expect(embedSpy).toHaveBeenCalledTimes(1);
  });
});
