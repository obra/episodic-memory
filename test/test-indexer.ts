/**
 * Test-specific indexing helpers
 * These allow direct indexing of test fixture files without requiring
 * the full .claude/projects directory structure
 */

import { initDatabase, insertExchange } from '../src/db.js';
import { initEmbeddings, generateExchangeEmbedding } from '../src/embeddings.js';
import { parseConversationFile } from '../src/parser.js';

/**
 * Index a list of conversation files directly (for testing)
 * Unlike the main indexConversations(), this doesn't expect .claude/projects structure
 */
export async function indexTestFiles(filePaths: string[]): Promise<void> {
  const db = initDatabase();
  await initEmbeddings();

  for (const filePath of filePaths) {
    const { project, exchanges } = await parseConversationFile(filePath);

    if (exchanges.length === 0) {
      console.log(`Skipping ${filePath} - no exchanges`);
      continue;
    }

    for (const exchange of exchanges) {
      const embedding = await generateExchangeEmbedding(
        exchange.userMessage,
        exchange.assistantMessage
      );
      insertExchange(db, exchange, embedding);
    }

    console.log(`Indexed ${filePath}: ${exchanges.length} exchanges`);
  }

  db.close();
}
