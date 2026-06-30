import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  exportOpencodeSessions,
  getOpencodeTranscriptFilePath,
} from '../src/opencode-sync.js';

describe('opencode sync export', () => {
  let testDir: string;
  let dbPath: string;
  let transcriptDir: string;
  const originalDbPath = process.env.EPISODIC_MEMORY_OPENCODE_DB_PATH;
  const originalTranscriptDir = process.env.EPISODIC_MEMORY_OPENCODE_TRANSCRIPT_DIR;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-opencode-sync-'));
    dbPath = join(testDir, 'opencode.db');
    transcriptDir = join(testDir, 'opencode-transcripts');
    process.env.EPISODIC_MEMORY_OPENCODE_DB_PATH = dbPath;
    process.env.EPISODIC_MEMORY_OPENCODE_TRANSCRIPT_DIR = transcriptDir;

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        worktree TEXT NOT NULL,
        name TEXT,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        sandboxes TEXT NOT NULL
      );
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        directory TEXT NOT NULL,
        title TEXT NOT NULL,
        version TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        agent TEXT,
        model TEXT
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);

    db.prepare(`
      INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes)
      VALUES ('proj_1', '/work/example-project', 'Example Project', 1700000000000, 1700000000000, '[]')
    `).run();
    db.prepare(`
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, agent, model)
      VALUES ('ses_test123', 'proj_1', 'test-session', '/work/example-project', 'Test Session', '1.17.8', 1700000000000, 1700000004000, 'build', ?)
    `).run(JSON.stringify({ id: 'claude-sonnet-4-5', providerID: 'anthropic', variant: 'default' }));
    db.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, 'ses_test123', ?, ?, ?)
    `).run('msg_user', 1700000001000, 1700000001000, JSON.stringify({
      role: 'user',
      time: { created: 1700000001000 },
      agent: 'build',
    }));
    db.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, 'ses_test123', ?, ?, ?)
    `).run('msg_assistant', 1700000002000, 1700000003000, JSON.stringify({
      role: 'assistant',
      time: { created: 1700000002000, completed: 1700000003000 },
      modelID: 'claude-sonnet-4-5',
      providerID: 'anthropic',
      agent: 'build',
      path: { cwd: '/work/example-project', root: '/work/example-project' },
    }));
    db.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, 'ses_test123', ?, ?, ?)
    `).run('prt_user_text', 'msg_user', 1700000001000, 1700000001000, JSON.stringify({
      type: 'text',
      text: 'Remember the opencode export contract.',
    }));
    db.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, 'ses_test123', ?, ?, ?)
    `).run('prt_assistant_text', 'msg_assistant', 1700000003000, 1700000003000, JSON.stringify({
      type: 'text',
      text: 'The opencode export contract is JSONL.',
    }));
    db.close();
  });

  afterEach(() => {
    if (originalDbPath === undefined) delete process.env.EPISODIC_MEMORY_OPENCODE_DB_PATH;
    else process.env.EPISODIC_MEMORY_OPENCODE_DB_PATH = originalDbPath;
    if (originalTranscriptDir === undefined) delete process.env.EPISODIC_MEMORY_OPENCODE_TRANSCRIPT_DIR;
    else process.env.EPISODIC_MEMORY_OPENCODE_TRANSCRIPT_DIR = originalTranscriptDir;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('exports opencode sessions to generated JSONL transcript files', () => {
    const result = exportOpencodeSessions();

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);

    const transcriptPath = getOpencodeTranscriptFilePath(transcriptDir, {
      sessionId: 'ses_test123',
      directory: '/work/example-project',
    });
    expect(existsSync(transcriptPath)).toBe(true);

    const lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
    expect(lines[0]).toMatchObject({
      type: 'opencode_session',
      session: {
        id: 'ses_test123',
        directory: '/work/example-project',
        version: '1.17.8',
        agent: 'build',
      },
    });
    expect(lines[1]).toMatchObject({
      type: 'opencode_message',
      message: { id: 'msg_user', role: 'user' },
      parts: [{ id: 'prt_user_text', type: 'text' }],
    });
    expect(lines[2]).toMatchObject({
      type: 'opencode_message',
      message: { id: 'msg_assistant', role: 'assistant' },
      parts: [{ id: 'prt_assistant_text', type: 'text' }],
    });
  });

  it('skips sessions whose transcript mtime is current', () => {
    const first = exportOpencodeSessions();
    expect(first.exported).toBe(1);

    const second = exportOpencodeSessions();
    expect(second.exported).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('returns no work when the opencode database is missing', () => {
    rmSync(dbPath, { force: true });
    mkdirSync(transcriptDir, { recursive: true });

    const result = exportOpencodeSessions();

    expect(result.exported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(statSync(transcriptDir).isDirectory()).toBe(true);
  });
});
