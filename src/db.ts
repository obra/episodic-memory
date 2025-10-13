import Database from 'better-sqlite3';
import { ConversationExchange } from './types.js';
import path from 'path';
import fs from 'fs';
import * as sqliteVec from 'sqlite-vec';
import { getDbPath } from './paths.js';

export function migrateSchema(db: Database.Database): void {
  const hasColumn = db.prepare(`
    SELECT COUNT(*) as count FROM pragma_table_info('exchanges')
    WHERE name='last_indexed'
  `).get() as { count: number };

  if (hasColumn.count === 0) {
    console.log('Migrating schema: adding last_indexed column...');
    db.prepare('ALTER TABLE exchanges ADD COLUMN last_indexed INTEGER').run();
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
      embedding BLOB
    )
  `);

  // Create vector search index
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_exchanges USING vec0(
      id TEXT PRIMARY KEY,
      embedding FLOAT[384]
    )
  `);

  // Create index on timestamp for sorting
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_timestamp ON exchanges(timestamp DESC)
  `);

  // Run migrations
  migrateSchema(db);

  return db;
}

export function insertExchange(
  db: Database.Database,
  exchange: ConversationExchange,
  embedding: number[]
): void {
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO exchanges
    (id, project, timestamp, user_message, assistant_message, archive_path, line_start, line_end, last_indexed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    now
  );

  // Insert into vector table (delete first since virtual tables don't support REPLACE)
  const delStmt = db.prepare(`DELETE FROM vec_exchanges WHERE id = ?`);
  delStmt.run(exchange.id);

  const vecStmt = db.prepare(`
    INSERT INTO vec_exchanges (id, embedding)
    VALUES (?, ?)
  `);

  vecStmt.run(exchange.id, Buffer.from(new Float32Array(embedding).buffer));
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
