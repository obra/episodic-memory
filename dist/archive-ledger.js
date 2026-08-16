export function ensureArchiveLedger(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS archive_objects (
      id TEXT PRIMARY KEY,
      remote_key TEXT NOT NULL UNIQUE,
      project TEXT NOT NULL,
      sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
      size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
      line_count INTEGER NOT NULL CHECK(line_count >= 0),
      source_mtime_ms INTEGER NOT NULL,
      summary_text TEXT,
      summary_state TEXT NOT NULL CHECK(summary_state IN ('missing','ready','empty','error')),
      upload_state TEXT NOT NULL CHECK(upload_state = 'uploaded'),
      uploaded_at_ms INTEGER NOT NULL,
      verified_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_archive_objects_remote_key ON archive_objects(remote_key);
  `);
}
export function putArchiveObject(db, record) {
    db.prepare(`
    INSERT INTO archive_objects
      (id, remote_key, project, sha256, size_bytes, line_count, source_mtime_ms,
       summary_text, summary_state, upload_state, uploaded_at_ms, verified_at_ms)
    VALUES
      (@id, @remoteKey, @project, @sha256, @sizeBytes, @lineCount, @sourceMtimeMs,
       @summaryText, @summaryState, @uploadState, @uploadedAtMs, @verifiedAtMs)
    ON CONFLICT(id) DO UPDATE SET
      remote_key=excluded.remote_key, project=excluded.project, sha256=excluded.sha256,
      size_bytes=excluded.size_bytes, line_count=excluded.line_count,
      source_mtime_ms=excluded.source_mtime_ms, summary_text=excluded.summary_text,
      summary_state=excluded.summary_state, upload_state=excluded.upload_state,
      uploaded_at_ms=excluded.uploaded_at_ms, verified_at_ms=excluded.verified_at_ms
  `).run(record);
}
export function getArchiveObject(db, identity) {
    const row = db.prepare(`
    SELECT id, remote_key, project, sha256, size_bytes, line_count, source_mtime_ms,
           summary_text, summary_state, upload_state, uploaded_at_ms, verified_at_ms
    FROM archive_objects WHERE id = ? OR remote_key = ? LIMIT 1
  `).get(identity, identity);
    return row ? {
        id: row.id, remoteKey: row.remote_key, project: row.project, sha256: row.sha256,
        sizeBytes: row.size_bytes, lineCount: row.line_count, sourceMtimeMs: row.source_mtime_ms,
        summaryText: row.summary_text, summaryState: row.summary_state, uploadState: row.upload_state,
        uploadedAtMs: row.uploaded_at_ms, verifiedAtMs: row.verified_at_ms,
    } : null;
}
