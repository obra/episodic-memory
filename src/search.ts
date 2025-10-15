import Database from 'better-sqlite3';
import { initDatabase } from './db.js';
import { initEmbeddings, generateEmbedding } from './embeddings.js';
import { SearchResult, ConversationExchange } from './types.js';
import fs from 'fs';

export interface SearchOptions {
  limit?: number;
  mode?: 'vector' | 'text' | 'both';
  after?: string;  // ISO date string
  before?: string; // ISO date string
}

function validateISODate(dateStr: string, paramName: string): void {
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

export async function searchConversations(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 10, mode = 'vector', after, before } = options;

  // Validate date parameters
  if (after) validateISODate(after, '--after');
  if (before) validateISODate(before, '--before');

  const db = initDatabase();

  let results: any[] = [];

  // Build time filter clause
  const timeFilter = [];
  if (after) timeFilter.push(`e.timestamp >= '${after}'`);
  if (before) timeFilter.push(`e.timestamp <= '${before}'`);
  const timeClause = timeFilter.length > 0 ? `AND ${timeFilter.join(' AND ')}` : '';

  if (mode === 'vector' || mode === 'both') {
    // Vector similarity search
    await initEmbeddings();
    const queryEmbedding = await generateEmbedding(query);

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
        ${timeClause}
      ORDER BY vec.distance ASC
    `);

    results = stmt.all(
      Buffer.from(new Float32Array(queryEmbedding).buffer),
      limit
    );
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
        ${timeClause}
      ORDER BY e.timestamp DESC
      LIMIT ?
    `);

    const textResults = textStmt.all(`%${query}%`, `%${query}%`, limit);

    if (mode === 'both') {
      // Merge and deduplicate by ID
      const seenIds = new Set(results.map(r => r.id));
      for (const textResult of textResults) {
        if (!seenIds.has((textResult as any).id)) {
          results.push(textResult);
        }
      }
    } else {
      results = textResults;
    }
  }

  db.close();

  return results.map((row: any) => {
    const exchange: ConversationExchange = {
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
    let summary: string | undefined;
    if (fs.existsSync(summaryPath)) {
      summary = fs.readFileSync(summaryPath, 'utf-8').trim();
    }

    // Create snippet (first 200 chars, collapse newlines)
    const snippetText = exchange.userMessage.substring(0, 200).replace(/\s+/g, ' ').trim();
    const snippet = snippetText + (exchange.userMessage.length > 200 ? '...' : '');

    return {
      exchange,
      similarity: mode === 'text' ? undefined : 1 - row.distance,
      snippet,
      summary
    } as SearchResult & { summary?: string };
  });
}

export function formatResults(results: Array<SearchResult & { summary?: string }>): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  let output = `Found ${results.length} relevant conversation${results.length > 1 ? 's' : ''}:\n\n`;

  results.forEach((result, index) => {
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
      const toolCounts = new Map<string, number>();
      result.exchange.toolCalls.forEach(tc => {
        toolCounts.set(tc.toolName, (toolCounts.get(tc.toolName) || 0) + 1);
      });
      const toolSummary = Array.from(toolCounts.entries())
        .map(([name, count]) => `${name}(${count})`)
        .join(', ');
      output += `   Tools: ${toolSummary}\n`;
    }

    // File path
    output += `   ${result.exchange.archivePath}:${result.exchange.lineStart}-${result.exchange.lineEnd}\n\n`;
  });

  return output;
}
