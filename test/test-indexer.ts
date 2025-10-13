/**
 * Test-specific indexing helpers
 * These allow direct indexing of test fixture files without requiring
 * the full .claude/projects directory structure
 */

import { initDatabase, insertExchange } from '../src/db.js';
import { initEmbeddings, generateExchangeEmbedding } from '../src/embeddings.js';
import { parseConversationFile } from '../src/parser.js';
import { suppressConsole } from './test-utils.js';

/**
 * Index a list of conversation files directly (for testing)
 * Unlike the main indexConversations(), this doesn't expect .claude/projects structure
 * Suppresses console output for clean test runs
 */
export async function indexTestFiles(filePaths: string[]): Promise<void> {
  const restore = suppressConsole();

  try {
    const db = initDatabase();
    await initEmbeddings();

    for (const filePath of filePaths) {
      const { project, exchanges } = await parseConversationFile(filePath);

      if (exchanges.length === 0) {
        continue;
      }

      for (const exchange of exchanges) {
        const embedding = await generateExchangeEmbedding(
          exchange.userMessage,
          exchange.assistantMessage
        );
        insertExchange(db, exchange, embedding);
      }
    }

    db.close();
  } finally {
    restore();
  }
}
