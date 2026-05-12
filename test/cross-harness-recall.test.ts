import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDatabase, insertExchange } from '../src/db.js';
import { searchConversations } from '../src/search.js';
import { ConversationExchange } from '../src/types.js';

describe('cross-harness recall', () => {
  let testDir: string;
  const originalDbPath = process.env.TEST_DB_PATH;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-cross-harness-'));
    process.env.TEST_DB_PATH = join(testDir, 'index.sqlite');
  });

  afterEach(() => {
    if (originalDbPath === undefined) delete process.env.TEST_DB_PATH;
    else process.env.TEST_DB_PATH = originalDbPath;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns harness metadata for Claude and Codex memories in the same index', async () => {
    const archiveDir = join(testDir, 'archive');
    mkdirSync(archiveDir, { recursive: true });
    const claudePath = join(archiveDir, 'claude-session.jsonl');
    const codexPath = join(archiveDir, 'codex-rollout.jsonl');
    writeFileSync(claudePath, '{}\n', 'utf-8');
    writeFileSync(codexPath, '{}\n', 'utf-8');

    const db = initDatabase();
    const base = {
      timestamp: '2026-05-12T20:00:00.000Z',
      userMessage: 'Recall shared-cross-harness-marker',
      assistantMessage: 'Remember shared-cross-harness-marker',
      lineStart: 1,
      lineEnd: 2,
    };
    const claudeExchange: ConversationExchange = {
      ...base,
      id: 'claude-memory',
      project: 'claude-project',
      archivePath: claudePath,
      harness: 'claude',
      sessionId: 'claude-session-1',
      agentVersion: '2.0.9',
      model: 'claude-sonnet-4-5',
    };
    const codexExchange: ConversationExchange = {
      ...base,
      id: 'codex-memory',
      project: 'codex-project',
      archivePath: codexPath,
      harness: 'codex',
      sessionId: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
      agentVersion: '0.130.0',
      model: 'gpt-5.5',
      modelProvider: 'openai',
    };

    insertExchange(db, claudeExchange, new Array(384).fill(0.1));
    insertExchange(db, codexExchange, new Array(384).fill(0.1));
    db.close();

    const results = await searchConversations('shared-cross-harness-marker', {
      mode: 'text',
      limit: 10,
    });

    const byId = new Map(results.map(result => [result.exchange.id, result.exchange]));
    expect(byId.get('claude-memory')).toMatchObject({
      harness: 'claude',
      sessionId: 'claude-session-1',
      agentVersion: '2.0.9',
      model: 'claude-sonnet-4-5',
    });
    expect(byId.get('codex-memory')).toMatchObject({
      harness: 'codex',
      sessionId: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
      agentVersion: '0.130.0',
      model: 'gpt-5.5',
      modelProvider: 'openai',
    });
  });
});
