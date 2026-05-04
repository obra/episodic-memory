import { initDatabase } from './db.js';
import { initEmbeddings, generateQueryEmbedding } from './embeddings.js';
import fs from 'fs';
import readline from 'readline';
/**
 * Build the AND-clause and bound-parameter list that constrains a search
 * by the optional time and metadata filters. Bound parameters keep us
 * safe from SQL injection without regex-based input scrubbing.
 */
function buildSearchFilters(options) {
    const parts = [];
    const params = [];
    if (options.after) {
        parts.push('e.timestamp >= ?');
        params.push(options.after);
    }
    if (options.before) {
        parts.push('e.timestamp <= ?');
        params.push(options.before);
    }
    if (options.project) {
        parts.push('e.project = ?');
        params.push(options.project);
    }
    if (options.session_id) {
        parts.push('e.session_id = ?');
        params.push(options.session_id);
    }
    if (options.git_branch) {
        parts.push('e.git_branch = ?');
        params.push(options.git_branch);
    }
    return {
        sql: parts.length ? `AND ${parts.join(' AND ')}` : '',
        params,
    };
}
function hasMetadataFilters(options) {
    return Boolean(options.project || options.session_id || options.git_branch);
}
/**
 * Convert an L2 (Euclidean) distance between two unit-normalized vectors
 * into a cosine similarity in [-1, 1].
 *
 * For unit vectors u, v:  ||u - v||^2 = 2 - 2 * cos(u, v)
 * Therefore:               cos(u, v) = 1 - d^2 / 2
 *
 * Embeddings written by src/embeddings.ts are normalized at write time, so
 * the L2 distance returned by sqlite-vec satisfies the unit-vector identity.
 */
export function l2DistanceToCosineSimilarity(distance) {
    const similarity = 1 - (distance * distance) / 2;
    return Math.max(-1, Math.min(1, similarity));
}
function validateISODate(dateStr, paramName) {
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDateRegex.test(dateStr)) {
        throw new Error(`Invalid ${paramName} date: "${dateStr}". Expected YYYY-MM-DD format (e.g., 2025-10-01)`);
    }
    // Verify it's actually a valid date
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        throw new Error(`Invalid ${paramName} date: "${dateStr}". Not a valid calendar date.`);
    }
}
export async function searchConversations(query, options = {}) {
    const { limit = 10, mode = 'both', after, before } = options;
    // Validate date parameters
    if (after)
        validateISODate(after, '--after');
    if (before)
        validateISODate(before, '--before');
    const db = initDatabase();
    let results = [];
    const { sql: filterClause, params: filterParams } = buildSearchFilters(options);
    if (mode === 'vector' || mode === 'both') {
        // Vector similarity search.
        // vec0 applies KNN before WHERE, so when extra metadata filters are
        // active we ask for more candidates than `limit` and trim afterwards.
        await initEmbeddings();
        const queryEmbedding = await generateQueryEmbedding(query);
        const k = hasMetadataFilters(options) ? limit * 3 : limit;
        const stmt = db.prepare(`
      SELECT
        e.id,
        e.project,
        e.timestamp,
        e.user_message,
        e.assistant_message,
        e.archive_path,
        e.line_start,
        e.line_end,
        vec.distance
      FROM vec_exchanges AS vec
      JOIN exchanges AS e ON vec.id = e.id
      WHERE vec.embedding MATCH ?
        AND k = ?
        AND e.is_sidechain = 0
        ${filterClause}
      ORDER BY vec.distance ASC
    `);
        results = stmt.all(Buffer.from(new Float32Array(queryEmbedding).buffer), k, ...filterParams);
        if (results.length > limit) {
            results = results.slice(0, limit);
        }
    }
    if (mode === 'text' || mode === 'both') {
        // Text search
        const textStmt = db.prepare(`
      SELECT
        e.id,
        e.project,
        e.timestamp,
        e.user_message,
        e.assistant_message,
        e.archive_path,
        e.line_start,
        e.line_end,
        0 as distance
      FROM exchanges AS e
      WHERE (e.user_message LIKE ? OR e.assistant_message LIKE ?)
        AND e.is_sidechain = 0
        ${filterClause}
      ORDER BY e.timestamp DESC
      LIMIT ?
    `);
        const textResults = textStmt.all(`%${query}%`, `%${query}%`, ...filterParams, limit);
        if (mode === 'both') {
            // Merge and deduplicate by ID
            const seenIds = new Set(results.map(r => r.id));
            for (const textResult of textResults) {
                if (!seenIds.has(textResult.id)) {
                    results.push(textResult);
                }
            }
        }
        else {
            results = textResults;
        }
    }
    db.close();
    return results.map((row) => {
        const exchange = {
            id: row.id,
            project: row.project,
            timestamp: row.timestamp,
            userMessage: row.user_message,
            assistantMessage: row.assistant_message,
            archivePath: row.archive_path,
            lineStart: row.line_start,
            lineEnd: row.line_end
        };
        // Try to load summary if available
        const summaryPath = row.archive_path.replace('.jsonl', '-summary.txt');
        let summary;
        if (fs.existsSync(summaryPath)) {
            summary = fs.readFileSync(summaryPath, 'utf-8').trim();
        }
        // Create snippet (first 200 chars, collapse newlines)
        const snippetText = exchange.userMessage.substring(0, 200).replace(/\s+/g, ' ').trim();
        const snippet = snippetText + (exchange.userMessage.length > 200 ? '...' : '');
        return {
            exchange,
            similarity: mode === 'text' ? undefined : l2DistanceToCosineSimilarity(row.distance),
            snippet,
            summary
        };
    });
}
// Helper function to count lines in a file efficiently
async function countLines(filePath) {
    try {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });
        let count = 0;
        for await (const line of rl) {
            if (line.trim())
                count++;
        }
        return count;
    }
    catch (error) {
        return 0; // Return 0 if file can't be read
    }
}
// Helper function to get file size in KB
function getFileSizeInKB(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return Math.round(stats.size / 1024 * 10) / 10; // Round to 1 decimal place
    }
    catch (error) {
        return 0;
    }
}
export async function formatResults(results) {
    if (results.length === 0) {
        return 'No results found.';
    }
    let output = `Found ${results.length} relevant conversation${results.length > 1 ? 's' : ''}:\n\n`;
    // Process results sequentially to get file metadata
    for (let index = 0; index < results.length; index++) {
        const result = results[index];
        const date = new Date(result.exchange.timestamp).toISOString().split('T')[0];
        const simPct = result.similarity !== undefined ? Math.round(result.similarity * 100) : null;
        // Header with match percentage
        output += `${index + 1}. [${result.exchange.project}, ${date}]`;
        if (simPct !== null) {
            output += ` - ${simPct}% match`;
        }
        output += '\n';
        // Show summary only if it's concise (< 300 chars)
        if (result.summary && result.summary.length < 300) {
            output += `   ${result.summary}\n`;
        }
        // Show snippet
        output += `   "${result.snippet}"\n`;
        // Show tool usage if available
        if (result.exchange.toolCalls && result.exchange.toolCalls.length > 0) {
            const toolCounts = new Map();
            result.exchange.toolCalls.forEach(tc => {
                toolCounts.set(tc.toolName, (toolCounts.get(tc.toolName) || 0) + 1);
            });
            const toolSummary = Array.from(toolCounts.entries())
                .map(([name, count]) => `${name}(${count})`)
                .join(', ');
            output += `   Tools: ${toolSummary}\n`;
        }
        // Get file metadata
        const fileSizeKB = getFileSizeInKB(result.exchange.archivePath);
        const totalLines = await countLines(result.exchange.archivePath);
        const lineRange = `${result.exchange.lineStart}-${result.exchange.lineEnd}`;
        // File information with metadata (clean format for smart tool selection)
        output += `   Lines ${lineRange} in ${result.exchange.archivePath} (${fileSizeKB}KB, ${totalLines} lines)\n\n`;
    }
    return output;
}
export async function searchMultipleConcepts(concepts, options = {}) {
    const { limit = 10 } = options;
    if (concepts.length === 0) {
        return [];
    }
    // Search for each concept independently
    const conceptResults = await Promise.all(concepts.map(concept => searchConversations(concept, { ...options, limit: limit * 5, mode: 'vector' })));
    // Build map of conversation path -> array of results (one per concept)
    const conversationMap = new Map();
    conceptResults.forEach((results, conceptIndex) => {
        results.forEach(result => {
            const key = result.exchange.archivePath;
            if (!conversationMap.has(key)) {
                conversationMap.set(key, []);
            }
            conversationMap.get(key).push({ ...result, conceptIndex });
        });
    });
    // Find conversations that match ALL concepts
    const multiConceptResults = [];
    for (const [archivePath, results] of conversationMap.entries()) {
        // Check if all concepts are represented
        const representedConcepts = new Set(results.map(r => r.conceptIndex));
        if (representedConcepts.size === concepts.length) {
            // All concepts found in this conversation
            const conceptSimilarities = concepts.map((_concept, index) => {
                const result = results.find(r => r.conceptIndex === index);
                return result?.similarity || 0;
            });
            const averageSimilarity = conceptSimilarities.reduce((sum, sim) => sum + sim, 0) / conceptSimilarities.length;
            // Use the first result's exchange data (they're all from the same conversation)
            const firstResult = results[0];
            multiConceptResults.push({
                exchange: firstResult.exchange,
                snippet: firstResult.snippet,
                conceptSimilarities,
                averageSimilarity
            });
        }
    }
    // Sort by average similarity (highest first)
    multiConceptResults.sort((a, b) => b.averageSimilarity - a.averageSimilarity);
    // Apply limit
    return multiConceptResults.slice(0, limit);
}
export async function formatMultiConceptResults(results, concepts) {
    if (results.length === 0) {
        return `No conversations found matching all concepts: ${concepts.join(', ')}`;
    }
    let output = `Found ${results.length} conversation${results.length > 1 ? 's' : ''} matching all concepts [${concepts.join(' + ')}]:\n\n`;
    // Process results sequentially to get file metadata
    for (let index = 0; index < results.length; index++) {
        const result = results[index];
        const date = new Date(result.exchange.timestamp).toISOString().split('T')[0];
        const avgPct = Math.round(result.averageSimilarity * 100);
        // Header with average match percentage
        output += `${index + 1}. [${result.exchange.project}, ${date}] - ${avgPct}% avg match\n`;
        // Show individual concept scores
        const scores = result.conceptSimilarities
            .map((sim, i) => `${concepts[i]}: ${Math.round(sim * 100)}%`)
            .join(', ');
        output += `   Concepts: ${scores}\n`;
        // Show snippet
        output += `   "${result.snippet}"\n`;
        // Show tool usage if available
        if (result.exchange.toolCalls && result.exchange.toolCalls.length > 0) {
            const toolCounts = new Map();
            result.exchange.toolCalls.forEach(tc => {
                toolCounts.set(tc.toolName, (toolCounts.get(tc.toolName) || 0) + 1);
            });
            const toolSummary = Array.from(toolCounts.entries())
                .map(([name, count]) => `${name}(${count})`)
                .join(', ');
            output += `   Tools: ${toolSummary}\n`;
        }
        // Get file metadata
        const fileSizeKB = getFileSizeInKB(result.exchange.archivePath);
        const totalLines = await countLines(result.exchange.archivePath);
        const lineRange = `${result.exchange.lineStart}-${result.exchange.lineEnd}`;
        // File information with metadata (clean format for smart tool selection)
        output += `   Lines ${lineRange} in ${result.exchange.archivePath} (${fileSizeKB}KB, ${totalLines} lines)\n\n`;
    }
    return output;
}
