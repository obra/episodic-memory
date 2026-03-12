import { randomUUID } from 'crypto';
export function insertFact(db, params) {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
    INSERT INTO facts (id, fact, category, scope_type, scope_project, source_exchange_ids, embedding, created_at, updated_at, consolidated_count, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
  `).run(id, params.fact, params.category, params.scope_type, params.scope_project, JSON.stringify(params.source_exchange_ids), params.embedding ? Buffer.from(new Float32Array(params.embedding).buffer) : null, now, now);
    // Insert into vector index
    if (params.embedding) {
        const delStmt = db.prepare('DELETE FROM vec_facts WHERE id = ?');
        delStmt.run(id);
        db.prepare('INSERT INTO vec_facts (id, embedding) VALUES (?, ?)').run(id, Buffer.from(new Float32Array(params.embedding).buffer));
    }
    return id;
}
export function getActiveFacts(db) {
    return db.prepare('SELECT * FROM facts WHERE is_active = 1 ORDER BY consolidated_count DESC')
        .all()
        .map(rowToFact);
}
export function getFactsByProject(db, project) {
    return db.prepare(`
    SELECT * FROM facts
    WHERE is_active = 1
      AND ((scope_type = 'project' AND scope_project = ?) OR scope_type = 'global')
    ORDER BY consolidated_count DESC
  `).all(project).map(rowToFact);
}
export function updateFact(db, id, params) {
    const now = new Date().toISOString();
    const updates = ['updated_at = ?'];
    const values = [now];
    if (params.fact !== undefined) {
        updates.push('fact = ?');
        values.push(params.fact);
    }
    if (params.embedding !== undefined) {
        updates.push('embedding = ?');
        values.push(params.embedding ? Buffer.from(new Float32Array(params.embedding).buffer) : null);
    }
    if (params.consolidated_count_increment) {
        updates.push('consolidated_count = consolidated_count + 1');
    }
    values.push(id);
    db.prepare(`UPDATE facts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    // Update vector index
    if (params.embedding) {
        db.prepare('DELETE FROM vec_facts WHERE id = ?').run(id);
        db.prepare('INSERT INTO vec_facts (id, embedding) VALUES (?, ?)').run(id, Buffer.from(new Float32Array(params.embedding).buffer));
    }
}
export function deactivateFact(db, id) {
    db.prepare('UPDATE facts SET is_active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}
export function deleteFact(db, id) {
    db.prepare('DELETE FROM vec_facts WHERE id = ?').run(id);
    db.prepare('DELETE FROM fact_revisions WHERE fact_id = ?').run(id);
    db.prepare('DELETE FROM facts WHERE id = ?').run(id);
}
export function insertRevision(db, params) {
    const id = randomUUID();
    db.prepare(`
    INSERT INTO fact_revisions (id, fact_id, previous_fact, new_fact, reason, source_exchange_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.fact_id, params.previous_fact, params.new_fact, params.reason, params.source_exchange_id, new Date().toISOString());
    return id;
}
export function getRevisions(db, factId) {
    return db.prepare('SELECT * FROM fact_revisions WHERE fact_id = ? ORDER BY created_at DESC').all(factId);
}
export function searchSimilarFacts(db, embedding, project, limit = 5, threshold = 0.85) {
    const vecResults = db.prepare(`
    SELECT id, distance
    FROM vec_facts
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(Buffer.from(new Float32Array(embedding).buffer), limit * 2);
    const results = [];
    for (const vr of vecResults) {
        // L2 distance -> cosine similarity approximation
        const similarity = 1 - (vr.distance * vr.distance) / 2;
        if (similarity < threshold)
            continue;
        const row = db.prepare('SELECT * FROM facts WHERE id = ? AND is_active = 1').get(vr.id);
        if (!row)
            continue;
        const fact = rowToFact(row);
        // Scope filter: same project or global only
        if (project && fact.scope_type === 'project' && fact.scope_project !== project)
            continue;
        results.push({ fact, distance: vr.distance });
        if (results.length >= limit)
            break;
    }
    return results;
}
export function getTopFacts(db, project, limit = 10) {
    return db.prepare(`
    SELECT * FROM facts
    WHERE is_active = 1
      AND ((scope_type = 'project' AND scope_project = ?) OR scope_type = 'global')
    ORDER BY consolidated_count DESC
    LIMIT ?
  `).all(project, limit).map(rowToFact);
}
export function getNewFactsSince(db, project, since) {
    return db.prepare(`
    SELECT * FROM facts
    WHERE is_active = 1
      AND created_at > ?
      AND ((scope_type = 'project' AND scope_project = ?) OR scope_type = 'global')
    ORDER BY created_at ASC
  `).all(since, project).map(rowToFact);
}
function rowToFact(row) {
    return {
        id: row.id,
        fact: row.fact,
        category: row.category,
        scope_type: row.scope_type,
        scope_project: row.scope_project,
        source_exchange_ids: row.source_exchange_ids ? JSON.parse(row.source_exchange_ids) : [],
        embedding: row.embedding ? new Float32Array(row.embedding.buffer ?? row.embedding) : null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        consolidated_count: row.consolidated_count,
        is_active: Boolean(row.is_active),
    };
}
