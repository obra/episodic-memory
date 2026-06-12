import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import {
  importCursorLegacy,
  collectLiveTranscriptIds,
} from '../src/cursor-legacy.js';
import { parseConversation } from '../src/parser.js';

const COMPOSER_A = '1f512764-8211-4582-88f7-251df5e43bc9';
const COMPOSER_B = '4e9e9864-6b33-42ff-83bb-5144f8819088';
const COMPOSER_EMPTY = 'aaaaaaaa-0000-0000-0000-000000000000';

function createFixtureDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)');
  const insert = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)');

  // Composer A: two bubbles with a terminal tool call carrying cwd
  insert.run(
    `composerData:${COMPOSER_A}`,
    JSON.stringify({
      composerId: COMPOSER_A,
      createdAt: Date.parse('2025-10-24T08:14:00.000Z'),
      lastUpdatedAt: Date.parse('2025-10-24T08:20:00.000Z'),
      fullConversationHeadersOnly: [
        { bubbleId: 'b1' },
        { bubbleId: 'b2' },
        { bubbleId: 'missing-bubble' }
      ]
    })
  );
  insert.run(
    `bubbleId:${COMPOSER_A}:b1`,
    JSON.stringify({
      type: 1,
      text: 'Search git history for OwnershipTransferred',
      createdAt: '2025-10-24T08:14:39.904Z'
    })
  );
  insert.run(
    `bubbleId:${COMPOSER_A}:b2`,
    JSON.stringify({
      type: 2,
      text: 'Searching the commit history now.',
      createdAt: '2025-10-24T08:15:02.000Z',
      toolFormerData: {
        name: 'run_terminal_cmd',
        params: JSON.stringify({
          command: 'git log --oneline',
          cwd: '/Users/jesse/Documents/GitHub/example-org/legacy-project'
        })
      }
    })
  );

  // Composer B: covered by a live agent transcript (must be skipped)
  insert.run(
    `composerData:${COMPOSER_B}`,
    JSON.stringify({
      composerId: COMPOSER_B,
      createdAt: Date.parse('2026-03-01T10:00:00.000Z'),
      fullConversationHeadersOnly: [{ bubbleId: 'b1' }]
    })
  );
  insert.run(
    `bubbleId:${COMPOSER_B}:b1`,
    JSON.stringify({ type: 1, text: 'hello', createdAt: '2026-03-01T10:00:01.000Z' })
  );

  // Empty composer: no messages
  insert.run(
    `composerData:${COMPOSER_EMPTY}`,
    JSON.stringify({
      composerId: COMPOSER_EMPTY,
      createdAt: Date.parse('2025-06-01T00:00:00.000Z'),
      fullConversationHeadersOnly: []
    })
  );

  db.close();
}

describe('cursor legacy import', () => {
  let tempDir: string;
  let dbPath: string;
  let exportDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cursor-legacy-'));
    dbPath = join(tempDir, 'state.vscdb');
    exportDir = join(tempDir, 'export');
    createFixtureDb(dbPath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exports legacy conversations as parseable cursor JSONL', async () => {
    const result = importCursorLegacy({ dbPath, exportDir });

    expect(result.exported).toBe(2);
    expect(result.skippedEmpty).toBe(1);
    expect(result.errors).toHaveLength(0);

    const outFile = join(exportDir, 'legacy-project', `${COMPOSER_A}.jsonl`);
    expect(existsSync(outFile)).toBe(true);

    const exchanges = await parseConversation(outFile, 'fallback', outFile);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].harness).toBe('cursor');
    expect(exchanges[0].userMessage).toBe('Search git history for OwnershipTransferred');
    expect(exchanges[0].assistantMessage).toBe('Searching the commit history now.');
    expect(exchanges[0].timestamp).toBe('2025-10-24T08:15:02.000Z');
    expect(exchanges[0].sessionId).toBe(COMPOSER_A);
    expect(exchanges[0].cwd).toBe('/Users/jesse/Documents/GitHub/example-org/legacy-project');
    expect(exchanges[0].project).toBe('legacy-project');
    expect(exchanges[0].toolCalls).toHaveLength(1);
  });

  it('derives project from tool cwd and stamps file mtime with conversation end time', () => {
    importCursorLegacy({ dbPath, exportDir });

    const outFile = join(exportDir, 'legacy-project', `${COMPOSER_A}.jsonl`);
    const stat = statSync(outFile);
    expect(stat.mtime.toISOString()).toBe('2025-10-24T08:20:00.000Z');
  });

  it('skips composers that have live agent transcripts', () => {
    const result = importCursorLegacy({
      dbPath,
      exportDir,
      liveTranscriptIds: new Set([COMPOSER_B])
    });

    expect(result.exported).toBe(1);
    expect(result.skippedLive).toBe(1);
    expect(existsSync(join(exportDir, 'cursor-unknown-project', `${COMPOSER_B}.jsonl`))).toBe(false);
  });

  it('is idempotent: re-running skips already-exported files', () => {
    const first = importCursorLegacy({ dbPath, exportDir });
    expect(first.exported).toBe(2);

    const second = importCursorLegacy({ dbPath, exportDir });
    expect(second.exported).toBe(0);
    expect(second.skippedExisting).toBe(2);
  });

  it('dry run reports counts without writing files', () => {
    const result = importCursorLegacy({ dbPath, exportDir, dryRun: true });

    expect(result.exported).toBe(2);
    expect(existsSync(exportDir)).toBe(false);
  });

  it('opens the database read-only', () => {
    const before = readFileSync(dbPath);
    importCursorLegacy({ dbPath, exportDir });
    const after = readFileSync(dbPath);
    expect(after.equals(before)).toBe(true);
  });
});

describe('collectLiveTranscriptIds', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cursor-live-ids-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('collects session UUIDs from agent-transcripts directories', () => {
    const sessionDir = join(tempDir, 'some-slug', 'agent-transcripts', COMPOSER_B);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${COMPOSER_B}.jsonl`), '{}\n');
    // Slug without agent-transcripts must not break the scan
    mkdirSync(join(tempDir, 'slug-without-transcripts', 'canvases'), { recursive: true });

    const ids = collectLiveTranscriptIds(tempDir);
    expect(ids.has(COMPOSER_B)).toBe(true);
    expect(ids.size).toBe(1);
  });

  it('returns an empty set for a missing directory', () => {
    const ids = collectLiveTranscriptIds(join(tempDir, 'does-not-exist'));
    expect(ids.size).toBe(0);
  });
});
