import Database from 'better-sqlite3';
import { initDatabase } from './db.js';
import { initEmbeddings, generateEmbedding } from './embeddings.js';
import { SearchResult, ConversationExchange, MultiConceptResult, SearchResultWithPagination, MultiConceptResultWithPagination, PaginationMeta } from './types.js';
import fs from 'fs';
import readline from 'readline';

export interface SearchOptions {
  limit?: number;
  offset?: number;
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
): Promise<SearchResultWithPagination> {
  const { limit = 10, offset = 0, mode = 'both', after, before } = options;

  // Validate date parameters
  if (after) validateISODate(after, '--after');
  if (before) validateISODate(before, '--before');

  const db = initDatabase();

  let results: any[] = [];
  let total = 0;

  // Build time filter clause using parameterized queries to prevent SQL injection
  // Even though dates are validated, parameterized queries are safer
  const timeConditions: string[] = [];
  const timeParams: string[] = [];
  if (after) {
    timeConditions.push(`e.timestamp >= ?`);
    timeParams.push(after);
  }
  if (before) {
    timeConditions.push(`e.timestamp <= ?`);
    timeParams.push(before);
  }
  const timeClause = timeConditions.length > 0 ? `AND ${timeConditions.join(' AND ')}` : '';

  if (mode === 'vector' || mode === 'both') {
    // Vector similarity search
    await initEmbeddings();
    const queryEmbedding = await generateEmbedding(query);
    const embeddingBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer);

    // For vector search with sqlite-vec, we need to get all results first and then paginate
    // because MATCH + k parameter doesn't support OFFSET
    const vectorStmt = db.prepare(`
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

    // Get limit + offset results to properly paginate
    const allVectorResults = vectorStmt.all(embeddingBuffer, limit + offset, ...timeParams);

    if (mode === 'vector') {
      // For vector-only mode, count is straightforward
      total = allVectorResults.length;
      results = allVectorResults.slice(offset, offset + limit);
    } else {
      // For 'both' mode, store all results for deduplication
      results = allVectorResults;
    }
  }

  if (mode === 'text' || mode === 'both') {
    // Text search
    if (mode === 'text') {
      // Count total text results
      const countStmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM exchanges AS e
        WHERE (e.user_message LIKE ? OR e.assistant_message LIKE ?)
          ${timeClause}
      `);
      const countResult = countStmt.get(`%${query}%`, `%${query}%`, ...timeParams) as { count: number };
      total = countResult.count;

      // Get paginated text results
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
        LIMIT ? OFFSET ?
      `);

      results = textStmt.all(`%${query}%`, `%${query}%`, ...timeParams, limit, offset);
    } else {
      // mode === 'both': Merge and deduplicate
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

      const textResults = textStmt.all(`%${query}%`, `%${query}%`, ...timeParams, limit + offset);

      // Merge and deduplicate by ID
      const seenIds = new Set(results.map(r => r.id));
      for (const textResult of textResults) {
        if (!seenIds.has((textResult as any).id)) {
          results.push(textResult);
        }
      }

      // For 'both' mode, total is the merged count before pagination
      total = results.length;
      // Apply pagination to merged results
      results = results.slice(offset, offset + limit);
    }
  }

  db.close();

  // Map to SearchResult objects
  const searchResults = results.map((row: any) => {
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

  // Build pagination metadata
  const pagination: PaginationMeta = {
    total,
    limit,
    offset,
    hasMore: offset + searchResults.length < total,
    nextOffset: offset + searchResults.length < total ? offset + limit : undefined
  };

  return {
    results: searchResults,
    pagination
  };
}

// Helper function to count lines in a file efficiently
async function countLines(filePath: string): Promise<number> {
  try {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let count = 0;
    for await (const line of rl) {
      if (line.trim()) count++;
    }
    return count;
  } catch (error) {
    return 0; // Return 0 if file can't be read
  }
}

// Helper function to get file size in KB
function getFileSizeInKB(filePath: string): number {
  try {
    const stats = fs.statSync(filePath);
    return Math.round(stats.size / 1024 * 10) / 10; // Round to 1 decimal place
  } catch (error) {
    return 0;
  }
}

export async function formatResults(
  results: Array<SearchResult & { summary?: string }>,
  pagination: PaginationMeta,
  format: 'json' | 'markdown' = 'markdown'
): Promise<string> {
  if (format === 'json') {
    return JSON.stringify({
      results: results.map(r => ({
        exchange: r.exchange,
        similarity: r.similarity,
        snippet: r.snippet
      })),
      pagination
    }, null, 2);
  }

  // Markdown format
  if (results.length === 0) {
    return `No results found.\n\nShowing 0 of ${pagination.total} results`;
  }

  let output = `## Search Results\n\n`;
  output += `Showing ${pagination.offset + 1}-${pagination.offset + results.length} of ${pagination.total} results\n\n`;

  // Process results sequentially to get file metadata
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    const date = new Date(result.exchange.timestamp).toISOString().split('T')[0];
    const simPct = result.similarity !== undefined ? Math.round(result.similarity * 100) : null;

    // Header with match percentage
    output += `${pagination.offset + index + 1}. [${result.exchange.project}, ${date}]`;
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

    // Get file metadata
    const fileSizeKB = getFileSizeInKB(result.exchange.archivePath);
    const totalLines = await countLines(result.exchange.archivePath);
    const lineRange = `${result.exchange.lineStart}-${result.exchange.lineEnd}`;

    // File information with metadata (clean format for smart tool selection)
    output += `   Lines ${lineRange} in ${result.exchange.archivePath} (${fileSizeKB}KB, ${totalLines} lines)\n\n`;
  }

  if (pagination.hasMore) {
    output += `---\n**More results available.** Use offset: ${pagination.nextOffset} to see next page.\n`;
  }

  return output;
}

export async function searchMultipleConcepts(
  concepts: string[],
  options: Omit<SearchOptions, 'mode'> = {}
): Promise<MultiConceptResultWithPagination> {
  const { limit = 10, offset = 0 } = options;

  if (concepts.length === 0) {
    return {
      results: [],
      pagination: {
        total: 0,
        limit,
        offset,
        hasMore: false
      }
    };
  }

  // Search for each concept independently
  const conceptResults = await Promise.all(
    concepts.map(concept => searchConversations(concept, { ...options, limit: limit * 5 + offset, mode: 'vector' }))
  );

  // Build map of conversation path -> array of results (one per concept)
  const conversationMap = new Map<string, Array<SearchResult & { conceptIndex: number }>>();

  conceptResults.forEach((resultWithPagination, conceptIndex) => {
    resultWithPagination.results.forEach(result => {
      const key = result.exchange.archivePath;
      if (!conversationMap.has(key)) {
        conversationMap.set(key, []);
      }
      conversationMap.get(key)!.push({ ...result, conceptIndex });
    });
  });

  // Find conversations that match ALL concepts
  const multiConceptResults: MultiConceptResult[] = [];

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

  // Count total before pagination
  const total = multiConceptResults.length;

  // Apply pagination
  const paginatedResults = multiConceptResults.slice(offset, offset + limit);

  // Build pagination metadata
  const pagination: PaginationMeta = {
    total,
    limit,
    offset,
    hasMore: offset + paginatedResults.length < total,
    nextOffset: offset + paginatedResults.length < total ? offset + limit : undefined
  };

  return {
    results: paginatedResults,
    pagination
  };
}

export async function formatMultiConceptResults(
  results: MultiConceptResult[],
  concepts: string[],
  pagination: PaginationMeta,
  format: 'json' | 'markdown' = 'markdown'
): Promise<string> {
  if (format === 'json') {
    return JSON.stringify({
      results: results,
      concepts: concepts,
      pagination
    }, null, 2);
  }

  // Markdown format
  if (results.length === 0) {
    return `No conversations found matching all concepts: ${concepts.join(', ')}\n\nShowing 0 of ${pagination.total} results`;
  }

  let output = `## Multi-Concept Search Results\n\n`;
  output += `Concepts: [${concepts.join(' + ')}]\n`;
  output += `Showing ${pagination.offset + 1}-${pagination.offset + results.length} of ${pagination.total} results\n\n`;

  // Process results sequentially to get file metadata
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    const date = new Date(result.exchange.timestamp).toISOString().split('T')[0];
    const avgPct = Math.round(result.averageSimilarity * 100);

    // Header with average match percentage
    output += `${pagination.offset + index + 1}. [${result.exchange.project}, ${date}] - ${avgPct}% avg match\n`;

    // Show individual concept scores
    const scores = result.conceptSimilarities
      .map((sim, i) => `${concepts[i]}: ${Math.round(sim * 100)}%`)
      .join(', ');
    output += `   Concepts: ${scores}\n`;

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

    // Get file metadata
    const fileSizeKB = getFileSizeInKB(result.exchange.archivePath);
    const totalLines = await countLines(result.exchange.archivePath);
    const lineRange = `${result.exchange.lineStart}-${result.exchange.lineEnd}`;

    // File information with metadata (clean format for smart tool selection)
    output += `   Lines ${lineRange} in ${result.exchange.archivePath} (${fileSizeKB}KB, ${totalLines} lines)\n\n`;
  }

  if (pagination.hasMore) {
    output += `---\n**More results available.** Use offset: ${pagination.nextOffset} to see next page.\n`;
  }

  return output;
}

