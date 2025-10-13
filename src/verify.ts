import fs from 'fs';
import path from 'path';
import { parseConversation } from './parser.js';
import { initDatabase, getAllExchanges, getFileLastIndexed } from './db.js';
import { getArchiveDir } from './paths.js';

export interface VerificationResult {
  missing: Array<{ path: string; reason: string }>;
  orphaned: Array<{ uuid: string; path: string }>;
  outdated: Array<{ path: string; fileTime: number; dbTime: number }>;
  corrupted: Array<{ path: string; error: string }>;
}

export async function verifyIndex(): Promise<VerificationResult> {
  const result: VerificationResult = {
    missing: [],
    orphaned: [],
    outdated: [],
    corrupted: []
  };

  const archiveDir = getArchiveDir();

  // Track all files we find
  const foundFiles = new Set<string>();

  // Find all conversation files
  if (!fs.existsSync(archiveDir)) {
    return result;
  }

  // Initialize database once for all checks
  const db = initDatabase();

  const projects = fs.readdirSync(archiveDir);
  let totalChecked = 0;

  for (const project of projects) {
    const projectPath = path.join(archiveDir, project);
    const stat = fs.statSync(projectPath);

    if (!stat.isDirectory()) continue;

    const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      totalChecked++;

      if (totalChecked % 100 === 0) {
        console.log(`  Checked ${totalChecked} conversations...`);
      }

      const conversationPath = path.join(projectPath, file);
      foundFiles.add(conversationPath);

      const summaryPath = conversationPath.replace('.jsonl', '-summary.txt');

      // Check for missing summary
      if (!fs.existsSync(summaryPath)) {
        result.missing.push({ path: conversationPath, reason: 'No summary file' });
        continue;
      }

      // Check if file is outdated (modified after last_indexed)
      const lastIndexed = getFileLastIndexed(db, conversationPath);
      if (lastIndexed !== null) {
        const fileStat = fs.statSync(conversationPath);
        if (fileStat.mtimeMs > lastIndexed) {
          result.outdated.push({
            path: conversationPath,
            fileTime: fileStat.mtimeMs,
            dbTime: lastIndexed
          });
        }
      }

      // Try parsing to detect corruption
      try {
        await parseConversation(conversationPath, project, conversationPath);
      } catch (error) {
        result.corrupted.push({
          path: conversationPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  console.log(`Verified ${totalChecked} conversations.`);

  // Check for orphaned database entries
  const dbExchanges = getAllExchanges(db);
  db.close();

  for (const exchange of dbExchanges) {
    if (!foundFiles.has(exchange.archivePath)) {
      result.orphaned.push({
        uuid: exchange.id,
        path: exchange.archivePath
      });
    }
  }

  return result;
}

export async function repairIndex(issues: VerificationResult): Promise<void> {
  console.log('Repairing index...');

  // To avoid circular dependencies, we import the indexer functions dynamically
  const { initDatabase, insertExchange, deleteExchange } = await import('./db.js');
  const { parseConversation } = await import('./parser.js');
  const { initEmbeddings, generateExchangeEmbedding } = await import('./embeddings.js');
  const { summarizeConversation } = await import('./summarizer.js');

  const db = initDatabase();
  await initEmbeddings();

  // Remove orphaned entries first
  for (const orphan of issues.orphaned) {
    console.log(`Removing orphaned entry: ${orphan.uuid}`);
    deleteExchange(db, orphan.uuid);
  }

  // Re-index missing and outdated conversations
  const toReindex = [
    ...issues.missing.map(m => m.path),
    ...issues.outdated.map(o => o.path)
  ];

  for (const conversationPath of toReindex) {
    console.log(`Re-indexing: ${conversationPath}`);
    try {
      // Extract project name from path
      const archiveDir = getArchiveDir();
      const relativePath = conversationPath.replace(archiveDir + path.sep, '');
      const project = relativePath.split(path.sep)[0];

      // Parse conversation
      const exchanges = await parseConversation(conversationPath, project, conversationPath);

      if (exchanges.length === 0) {
        console.log(`  Skipped (no exchanges)`);
        continue;
      }

      // Generate/update summary
      const summaryPath = conversationPath.replace('.jsonl', '-summary.txt');
      const summary = await summarizeConversation(exchanges);
      fs.writeFileSync(summaryPath, summary, 'utf-8');
      console.log(`  Created summary: ${summary.split(/\s+/).length} words`);

      // Index exchanges
      for (const exchange of exchanges) {
        const embedding = await generateExchangeEmbedding(
          exchange.userMessage,
          exchange.assistantMessage
        );
        insertExchange(db, exchange, embedding);
      }

      console.log(`  Indexed ${exchanges.length} exchanges`);
    } catch (error) {
      console.error(`Failed to re-index ${conversationPath}:`, error);
    }
  }

  db.close();

  // Report corrupted files (manual intervention needed)
  if (issues.corrupted.length > 0) {
    console.log('\n⚠️  Corrupted files (manual review needed):');
    issues.corrupted.forEach(c => console.log(`  ${c.path}: ${c.error}`));
  }

  console.log('✅ Repair complete.');
}
