import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getOpencodeDbPath, getOpencodeTranscriptDir } from './paths.js';

export interface OpencodeExportResult {
  exported: number;
  skipped: number;
  errors: Array<{ sessionId?: string; error: string }>;
  dbPath: string;
  transcriptDir: string;
}

interface OpencodeSessionRow {
  id: string;
  project_id: string;
  slug: string;
  directory: string;
  title: string;
  version: string;
  time_created: number;
  time_updated: number;
  agent?: string | null;
  model?: string | null;
  project_name?: string | null;
  project_worktree?: string | null;
}

interface OpencodeMessageRow {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

interface OpencodePartRow {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

function safeParseJson(value: string | null | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function safeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'unknown';
  return trimmed.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function projectNameFromDirectory(directory: string): string {
  return safeSegment(path.basename(directory) || directory);
}

function dateFromMillis(value: number | undefined): Date {
  const millis = Number.isFinite(value) ? value! : Date.now();
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table) as { name: string } | undefined;
  return Boolean(row);
}

export function getOpencodeTranscriptFilePath(
  transcriptDir: string,
  input: { sessionId: string; directory: string }
): string {
  const project = projectNameFromDirectory(input.directory);
  return path.join(transcriptDir, project, `opencode-${safeSegment(input.sessionId)}.jsonl`);
}

function shouldExportSession(filePath: string, sessionUpdatedMs: number): boolean {
  if (!fs.existsSync(filePath)) return true;
  const stat = fs.statSync(filePath);
  return Math.floor(stat.mtimeMs) < Math.floor(sessionUpdatedMs);
}

function writeSessionTranscript(
  db: Database.Database,
  session: OpencodeSessionRow,
  filePath: string
): void {
  const messages = db.prepare(`
    SELECT id, session_id, time_created, time_updated, data
    FROM message
    WHERE session_id = ?
    ORDER BY time_created, id
  `).all(session.id) as OpencodeMessageRow[];

  const partsByMessage = new Map<string, OpencodePartRow[]>();
  if (messages.length > 0) {
    const parts = db.prepare(`
      SELECT id, message_id, session_id, time_created, time_updated, data
      FROM part
      WHERE session_id = ?
      ORDER BY time_created, id
    `).all(session.id) as OpencodePartRow[];
    for (const part of parts) {
      const list = partsByMessage.get(part.message_id) || [];
      list.push(part);
      partsByMessage.set(part.message_id, list);
    }
  }

  const lines: string[] = [];
  lines.push(JSON.stringify({
    type: 'opencode_session',
    session: {
      id: session.id,
      projectID: session.project_id,
      slug: session.slug,
      directory: session.directory,
      title: session.title,
      version: session.version,
      agent: session.agent || undefined,
      model: safeParseJson(session.model),
      time: {
        created: session.time_created,
        updated: session.time_updated,
      },
    },
    project: {
      name: session.project_name || undefined,
      worktree: session.project_worktree || undefined,
    },
  }));

  for (const message of messages) {
    const parsedMessage = safeParseJson(message.data);
    const messageData = parsedMessage && typeof parsedMessage === 'object'
      ? parsedMessage as Record<string, unknown>
      : { raw: parsedMessage };
    const parts = (partsByMessage.get(message.id) || []).map(part => {
      const parsedPart = safeParseJson(part.data);
      const partData = parsedPart && typeof parsedPart === 'object'
        ? parsedPart as Record<string, unknown>
        : { raw: parsedPart };
      return {
        ...partData,
        id: part.id,
        sessionID: part.session_id,
        messageID: part.message_id,
        timeCreated: part.time_created,
        timeUpdated: part.time_updated,
      };
    });

    lines.push(JSON.stringify({
      type: 'opencode_message',
      sessionID: message.session_id,
      message: {
        ...messageData,
        id: message.id,
        sessionID: message.session_id,
        timeCreated: message.time_created,
        timeUpdated: message.time_updated,
      },
      parts,
    }));
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tempPath, `${lines.join('\n')}\n`, 'utf-8');
  fs.renameSync(tempPath, filePath);
  const mtime = dateFromMillis(session.time_updated);
  fs.utimesSync(filePath, mtime, mtime);
}

export function exportOpencodeSessions(options: {
  dbPath?: string;
  transcriptDir?: string;
} = {}): OpencodeExportResult {
  const dbPath = options.dbPath || getOpencodeDbPath();
  const transcriptDir = options.transcriptDir || getOpencodeTranscriptDir();
  const result: OpencodeExportResult = {
    exported: 0,
    skipped: 0,
    errors: [],
    dbPath,
    transcriptDir,
  };

  if (!fs.existsSync(dbPath)) {
    return result;
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!tableExists(db, 'session') || !tableExists(db, 'message') || !tableExists(db, 'part')) {
      return result;
    }

    const sessions = db.prepare(`
      SELECT
        s.id,
        s.project_id,
        s.slug,
        s.directory,
        s.title,
        s.version,
        s.time_created,
        s.time_updated,
        s.agent,
        s.model,
        p.name AS project_name,
        p.worktree AS project_worktree
      FROM session s
      LEFT JOIN project p ON p.id = s.project_id
      ORDER BY s.time_updated, s.id
    `).all() as OpencodeSessionRow[];

    for (const session of sessions) {
      try {
        const filePath = getOpencodeTranscriptFilePath(transcriptDir, {
          sessionId: session.id,
          directory: session.directory,
        });
        if (!shouldExportSession(filePath, session.time_updated)) {
          result.skipped++;
          continue;
        }
        writeSessionTranscript(db, session, filePath);
        result.exported++;
      } catch (error) {
        result.errors.push({
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    result.errors.push({
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    db.close();
  }

  return result;
}
