import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  rmSync,
  statSync,
  utimesSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

// Mock the embedding backend so no model loads and calls are counted. sync.ts
// loads it via `await import('./embeddings.js')`, which vi.mock intercepts
// when registered before sync is imported (see test/sync-embeddings-unavailable.test.ts).
const embedSpy = vi.fn(async () => new Array(384).fill(0));
vi.mock('../src/embeddings.js', () => ({
  initEmbeddings: vi.fn(async () => {}),
  generateExchangeEmbedding: embedSpy,
  generateQueryEmbedding: vi.fn(),
  generateEmbedding: vi.fn(),
  initEmbeddingsFailed: false,
}));

import { syncConversations, shouldSkipConversation } from '../src/sync.js';

const DO_NOT_INDEX_MARKER =
  '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>';

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

function exchangeLines(seq: number, sessionId: string): string {
  return userLine(seq, sessionId, `question ${seq}`) + '\n' +
    assistantLine(seq, sessionId, `answer ${seq}`) + '\n';
}

describe('sync: high-water mark (#152 Part A)', () => {
  let testDir: string;
  let sourceDir: string;
  let destDir: string;
  let dbPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-sync-incremental-'));
    sourceDir = join(testDir, 'source');
    destDir = join(testDir, 'dest');
    dbPath = join(testDir, 'test.db');
    mkdirSync(sourceDir, { recursive: true });

    process.env.TEST_DB_PATH = dbPath;

    // Initialize the schema the same way the app does (matches test/sync.test.ts).
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

    embedSpy.mockClear();
  });

  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('only re-embeds newly appended exchanges on a subsequent sync, not the whole file', async () => {
    const sessionId = '019aff97-5651-71e0-80ec-b4f2c51095c3';
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const srcFile = join(sourceDir, 'project-a', `${sessionId}.jsonl`);

    // Two exchanges.
    writeFileSync(srcFile, exchangeLines(1, sessionId) + exchangeLines(2, sessionId), 'utf-8');

    const result1 = await syncConversations(sourceDir, destDir, { skipSummaries: true });
    expect(result1.copied).toBe(1);
    expect(result1.indexed).toBe(1);
    expect(embedSpy).toHaveBeenCalledTimes(2);

    const callsAfterFirstSync = embedSpy.mock.calls.length;

    // Append a 3rd exchange and bump mtime forward so copyIfNewer copies it.
    appendFileSync(srcFile, exchangeLines(3, sessionId), 'utf-8');
    const future = new Date(Date.now() + 5000);
    utimesSync(srcFile, future, future);

    const result2 = await syncConversations(sourceDir, destDir, { skipSummaries: true });
    expect(result2.copied).toBe(1);
    expect(result2.indexed).toBe(1);

    const newCalls = embedSpy.mock.calls.length - callsAfterFirstSync;
    // Only the appended exchange should be re-embedded — NOT all 3.
    expect(newCalls).toBe(1);
  });
});

describe('shouldSkipConversation: fail-closed streaming marker scan (#152 Part B)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-marker-scan-'));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('finds the DO NOT INDEX marker near the end of a multi-chunk (multi-MB) file', () => {
    const filePath = join(testDir, 'large-marked.jsonl');
    const filler = 'x'.repeat(3 * 1024 * 1024); // ~3 MB, spans several 1-MiB scan chunks
    writeFileSync(filePath, filler + DO_NOT_INDEX_MARKER, 'utf-8');

    expect(shouldSkipConversation(filePath)).toBe(true);
  });

  it('returns false for a same-size large file with no marker (streaming confirms cleanliness, not just size)', () => {
    const filePath = join(testDir, 'large-clean.jsonl');
    const filler = 'x'.repeat(3 * 1024 * 1024);
    writeFileSync(filePath, filler, 'utf-8');

    expect(shouldSkipConversation(filePath)).toBe(false);
    expect(statSync(filePath).size).toBeGreaterThanOrEqual(3 * 1024 * 1024);
  });

  it('finds the marker even when it straddles an exact 1-MiB chunk boundary', () => {
    const filePath = join(testDir, 'boundary-marked.jsonl');
    const chunkBytes = 1 << 20; // 1 MiB, matches MARKER_SCAN_CHUNK_BYTES
    const markerLen = DO_NOT_INDEX_MARKER.length;
    // Filler chosen so the marker starts before the chunk boundary and ends after it.
    const fillerLen = chunkBytes - Math.floor(markerLen / 2);
    const filler = 'y'.repeat(fillerLen);
    writeFileSync(filePath, filler + DO_NOT_INDEX_MARKER, 'utf-8');

    expect(shouldSkipConversation(filePath)).toBe(true);
  });

  it('fails CLOSED (skips) on a read error, e.g. a directory path', () => {
    // Passing a directory to the streaming reader throws (EISDIR). On main
    // this returned false (fail open); the fix must return true (skip) instead.
    expect(shouldSkipConversation(testDir)).toBe(true);
  });

  it('fails CLOSED (skips) on a non-existent path', () => {
    expect(shouldSkipConversation(join(testDir, 'does-not-exist.jsonl'))).toBe(true);
  });
});
