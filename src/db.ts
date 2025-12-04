import Database from 'better-sqlite3';
import { ConversationExchange } from './types.js';
import { SessionSummary } from './session-summary-types.js';
import path from 'path';
import fs from 'fs';
import * as sqliteVec from 'sqlite-vec';
import { getDbPath } from './paths.js';

export function migrateSchema(db: Database.Database): void {
  const columns = db.prepare(`SELECT name FROM pragma_table_info('exchanges')`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map(c => c.name));

  const migrations: Array<{ name: string; sql: string }> = [
    { name: 'last_indexed', sql: 'ALTER TABLE exchanges ADD COLUMN last_indexed INTEGER' },
    { name: 'parent_uuid', sql: 'ALTER TABLE exchanges ADD COLUMN parent_uuid TEXT' },
    { name: 'is_sidechain', sql: 'ALTER TABLE exchanges ADD COLUMN is_sidechain BOOLEAN DEFAULT 0' },
    { name: 'session_id', sql: 'ALTER TABLE exchanges ADD COLUMN session_id TEXT' },
    { name: 'cwd', sql: 'ALTER TABLE exchanges ADD COLUMN cwd TEXT' },
    { name: 'git_branch', sql: 'ALTER TABLE exchanges ADD COLUMN git_branch TEXT' },
    { name: 'claude_version', sql: 'ALTER TABLE exchanges ADD COLUMN claude_version TEXT' },
    { name: 'thinking_level', sql: 'ALTER TABLE exchanges ADD COLUMN thinking_level TEXT' },
    { name: 'thinking_disabled', sql: 'ALTER TABLE exchanges ADD COLUMN thinking_disabled BOOLEAN' },
    { name: 'thinking_triggers', sql: 'ALTER TABLE exchanges ADD COLUMN thinking_triggers TEXT' },
  ];

  let migrated = false;
  for (const migration of migrations) {
    if (!columnNames.has(migration.name)) {
      console.log(`Migrating schema: adding ${migration.name} column...`);
      db.prepare(migration.sql).run();
      migrated = true;
    }
  }

  if (migrated) {
    console.log('Migration complete.');
  }
}

export function initDatabase(): Database.Database {
  const dbPath = getDbPath();

  // Ensure directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Create exchanges table
  db.exec(`
    CREATE TABLE IF NOT EXISTS exchanges (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      user_message TEXT NOT NULL,
      assistant_message TEXT NOT NULL,
      archive_path TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      embedding BLOB,
      last_indexed INTEGER,
      parent_uuid TEXT,
      is_sidechain BOOLEAN DEFAULT 0,
      session_id TEXT,
      cwd TEXT,
      git_branch TEXT,
      claude_version TEXT,
      thinking_level TEXT,
      thinking_disabled BOOLEAN,
      thinking_triggers TEXT
    )
  `);

  // Create tool_calls table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      exchange_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_input TEXT,
      tool_result TEXT,
      is_error BOOLEAN DEFAULT 0,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (exchange_id) REFERENCES exchanges(id)
    )
  `);

  // Create vector search index
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_exchanges USING vec0(
      id TEXT PRIMARY KEY,
      embedding FLOAT[384]
    )
  `);

  // Create session_summaries table
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      duration_minutes INTEGER,
      one_liner TEXT NOT NULL,
      detailed TEXT NOT NULL,
      decisions TEXT,
      files_modified TEXT,
      work_items TEXT,
      tools_used TEXT,
      outcomes TEXT,
      next_steps TEXT,
      tags TEXT,
      UNIQUE(session_id)
    )
  `);

  // Create vector search index for summaries
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
      id TEXT PRIMARY KEY,
      embedding FLOAT[384]
    )
  `);

  // Run migrations first
  migrateSchema(db);

  // Create indexes (after migrations ensure columns exist)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_timestamp ON exchanges(timestamp DESC)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_id ON exchanges(session_id)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project ON exchanges(project)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sidechain ON exchanges(is_sidechain)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_git_branch ON exchanges(git_branch)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_name ON tool_calls(tool_name)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_exchange ON tool_calls(exchange_id)
  `);

  // Create indexes for summaries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_summary_project ON session_summaries(project)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_summary_timestamp ON session_summaries(timestamp DESC)
  `);

  return db;
}

export function insertExchange(
  db: Database.Database,
  exchange: ConversationExchange,
  embedding: number[],
  toolNames?: string[]
): void {
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO exchanges
    (id, project, timestamp, user_message, assistant_message, archive_path, line_start, line_end, last_indexed,
     parent_uuid, is_sidechain, session_id, cwd, git_branch, claude_version,
     thinking_level, thinking_disabled, thinking_triggers)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    exchange.id,
    exchange.project,
    exchange.timestamp,
    exchange.userMessage,
    exchange.assistantMessage,
    exchange.archivePath,
    exchange.lineStart,
    exchange.lineEnd,
    now,
    exchange.parentUuid || null,
    exchange.isSidechain ? 1 : 0,
    exchange.sessionId || null,
    exchange.cwd || null,
    exchange.gitBranch || null,
    exchange.claudeVersion || null,
    exchange.thinkingLevel || null,
    exchange.thinkingDisabled ? 1 : 0,
    exchange.thinkingTriggers || null
  );

  // Insert into vector table (delete first since virtual tables don't support REPLACE)
  const delStmt = db.prepare(`DELETE FROM vec_exchanges WHERE id = ?`);
  delStmt.run(exchange.id);

  const vecStmt = db.prepare(`
    INSERT INTO vec_exchanges (id, embedding)
    VALUES (?, ?)
  `);

  vecStmt.run(exchange.id, Buffer.from(new Float32Array(embedding).buffer));

  // Insert tool calls if present
  if (exchange.toolCalls && exchange.toolCalls.length > 0) {
    const toolStmt = db.prepare(`
      INSERT OR REPLACE INTO tool_calls
      (id, exchange_id, tool_name, tool_input, tool_result, is_error, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const toolCall of exchange.toolCalls) {
      toolStmt.run(
        toolCall.id,
        toolCall.exchangeId,
        toolCall.toolName,
        toolCall.toolInput ? JSON.stringify(toolCall.toolInput) : null,
        toolCall.toolResult || null,
        toolCall.isError ? 1 : 0,
        toolCall.timestamp
      );
    }
  }
}

export function getAllExchanges(db: Database.Database): Array<{ id: string; archivePath: string }> {
  const stmt = db.prepare(`SELECT id, archive_path as archivePath FROM exchanges`);
  return stmt.all() as Array<{ id: string; archivePath: string }>;
}

export function getFileLastIndexed(db: Database.Database, archivePath: string): number | null {
  const stmt = db.prepare(`
    SELECT MAX(last_indexed) as lastIndexed
    FROM exchanges
    WHERE archive_path = ?
  `);
  const row = stmt.get(archivePath) as { lastIndexed: number | null };
  return row.lastIndexed;
}

export function deleteExchange(db: Database.Database, id: string): void {
  // Delete from vector table
  db.prepare(`DELETE FROM vec_exchanges WHERE id = ?`).run(id);

  // Delete from main table
  db.prepare(`DELETE FROM exchanges WHERE id = ?`).run(id);
}

export function insertSessionSummary(
  db: Database.Database,
  summary: SessionSummary,
  embedding: number[]
): void {
  // Delete any existing summary for this session (and its vector entry) to prevent orphans
  // When INSERT OR REPLACE triggers, SQLite deletes the old row (with old id) and inserts new row (with new id)
  // We must delete the old vector entry by looking up the existing id first
  const existing = db.prepare(`SELECT id FROM session_summaries WHERE session_id = ?`).get(summary.sessionId) as { id: string } | undefined;
  if (existing) {
    db.prepare(`DELETE FROM vec_summaries WHERE id = ?`).run(existing.id);
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO session_summaries
    (id, session_id, project, timestamp, duration_minutes, one_liner, detailed,
     decisions, files_modified, work_items, tools_used, outcomes, next_steps, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    summary.id,
    summary.sessionId,
    summary.project,
    summary.timestamp,
    summary.durationMinutes,
    summary.summary.oneLiner,
    summary.summary.detailed,
    JSON.stringify(summary.decisions),
    JSON.stringify(summary.filesModified),
    JSON.stringify(summary.workItems),
    JSON.stringify(summary.toolsUsed),
    JSON.stringify(summary.outcomes),
    JSON.stringify(summary.nextSteps),
    JSON.stringify(summary.tags)
  );

  // Insert into vector table
  const vecStmt = db.prepare(`
    INSERT INTO vec_summaries (id, embedding)
    VALUES (?, ?)
  `);
  vecStmt.run(summary.id, Buffer.from(new Float32Array(embedding).buffer));
}

export function searchSummaries(
  db: Database.Database,
  embedding: number[],
  limit: number = 10
): SessionSummary[] {
  const stmt = db.prepare(`
    SELECT
      s.id, s.session_id, s.project, s.timestamp, s.duration_minutes,
      s.one_liner, s.detailed, s.decisions, s.files_modified,
      s.work_items, s.tools_used, s.outcomes, s.next_steps, s.tags,
      v.distance
    FROM vec_summaries v
    JOIN session_summaries s ON v.id = s.id
    WHERE v.embedding MATCH ? AND k = ?
    ORDER BY v.distance
  `);

  const rows = stmt.all(
    Buffer.from(new Float32Array(embedding).buffer),
    limit
  ) as any[];

  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    project: row.project,
    timestamp: row.timestamp,
    durationMinutes: row.duration_minutes,
    summary: {
      oneLiner: row.one_liner,
      detailed: row.detailed
    },
    decisions: JSON.parse(row.decisions || '[]'),
    filesModified: JSON.parse(row.files_modified || '[]'),
    workItems: JSON.parse(row.work_items || '[]'),
    toolsUsed: JSON.parse(row.tools_used || '[]'),
    outcomes: JSON.parse(row.outcomes || '[]'),
    nextSteps: JSON.parse(row.next_steps || '[]'),
    tags: JSON.parse(row.tags || '[]')
  }));
}

export function getSummaryBySessionId(
  db: Database.Database,
  sessionId: string
): SessionSummary | null {
  const stmt = db.prepare(`
    SELECT id, session_id, project, timestamp, duration_minutes,
           one_liner, detailed, decisions, files_modified,
           work_items, tools_used, outcomes, next_steps, tags
    FROM session_summaries
    WHERE session_id = ?
  `);

  const row = stmt.get(sessionId) as any;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    project: row.project,
    timestamp: row.timestamp,
    durationMinutes: row.duration_minutes,
    summary: {
      oneLiner: row.one_liner,
      detailed: row.detailed
    },
    decisions: JSON.parse(row.decisions || '[]'),
    filesModified: JSON.parse(row.files_modified || '[]'),
    workItems: JSON.parse(row.work_items || '[]'),
    toolsUsed: JSON.parse(row.tools_used || '[]'),
    outcomes: JSON.parse(row.outcomes || '[]'),
    nextSteps: JSON.parse(row.next_steps || '[]'),
    tags: JSON.parse(row.tags || '[]')
  };
}
