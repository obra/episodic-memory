import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { parseConversation } from './parser.js';
import { getAllExchanges } from './db.js';
import { getArchiveDir, getDbPath, getExcludedProjects, findJsonlFiles, statIfExists } from './paths.js';
import { isErroredSentinel } from './summary-sentinel.js';

export interface VerificationResult {
  missing: Array<{ path: string; reason: string }>;
  unindexed: Array<{ path: string }>;
  orphaned: Array<{ uuid: string; path: string }>;
  outdated: Array<{ path: string; fileTime: number; dbTime: number }>;
  archiveRefreshes: Array<{ path: string; fileTime: number; dbTime: number }>;
  corrupted: Array<{ path: string; error: string }>;
}

export async function verifyIndex(): Promise<VerificationResult> {
  const result: VerificationResult = {
    missing: [],
    unindexed: [],
    orphaned: [],
    outdated: [],
    archiveRefreshes: [],
    corrupted: []
  };

  const archiveDir = getArchiveDir();

  // Track all files we find
  const foundFiles = new Set<string>();

  // Find all conversation files
  if (!fs.existsSync(archiveDir)) {
    return result;
  }

  // Verification must not create or migrate the index it is measuring.
  const dbPath = getDbPath();
  const db = fs.existsSync(dbPath) ? new Database(dbPath, { readonly: true, fileMustExist: true }) : null;
  const indexState = db?.prepare(`
    SELECT MAX(line_end) AS maxLineEnd, MAX(last_indexed) AS lastIndexed
    FROM exchanges WHERE archive_path = ?
  `);

  const projects = fs.readdirSync(archiveDir);
  const excludedProjects = getExcludedProjects();
  const excludedDirSet = new Set(excludedProjects);
  let totalChecked = 0;

  for (const project of projects) {
    if (excludedProjects.includes(project)) {
      console.log("\nSkipping excluded project: " + project);
      continue;
    }

    const projectPath = path.join(archiveDir, project);
    const stat = statIfExists(projectPath);

    if (!stat?.isDirectory()) continue;

    const files = findJsonlFiles(projectPath, excludedDirSet);

    for (const file of files) {
      totalChecked++;

      if (totalChecked % 100 === 0) {
        console.log(`  Checked ${totalChecked} conversations...`);
      }

      const conversationPath = path.join(projectPath, file);
      foundFiles.add(conversationPath);

      const summaryPath = conversationPath.replace('.jsonl', '-summary.txt');

      // Check for missing or errored summary. An error sentinel (#96) means a
      // previous summarization failed — verify treats it as "missing" so repair
      // re-attempts it rather than reporting the conversation as healthy.
      if (!fs.existsSync(summaryPath)) {
        result.missing.push({ path: conversationPath, reason: 'No summary file' });
      } else if (isErroredSentinel(fs.readFileSync(summaryPath, 'utf-8'))) {
        result.missing.push({ path: conversationPath, reason: 'Previous summarization failed (error sentinel)' });
      }

      const state = indexState?.get(conversationPath) as { maxLineEnd: number | null; lastIndexed: number | null } | undefined;
      const maxLineEnd = state?.maxLineEnd ?? null;
      if (maxLineEnd === null) result.unindexed.push({ path: conversationPath });

      // Parse independently of summary state and mtime. Only exchanges past
      // the indexed high-water mark are a real index delta.
      try {
        const exchanges = await parseConversation(conversationPath, project, conversationPath);
        if (maxLineEnd !== null) {
          const fileTime = fs.statSync(conversationPath).mtimeMs;
          const dbTime = state?.lastIndexed ?? 0;
          if (exchanges.some(exchange => exchange.lineEnd > maxLineEnd)) {
            result.outdated.push({ path: conversationPath, fileTime, dbTime });
          } else if (state?.lastIndexed != null && fileTime > state.lastIndexed) {
            result.archiveRefreshes.push({ path: conversationPath, fileTime, dbTime });
          }
        }
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
  const dbExchanges = db ? getAllExchanges(db) : [];
  db?.close();

  for (const exchange of dbExchanges) {
    if (!foundFiles.has(exchange.archivePath) && !statIfExists(exchange.archivePath)?.isFile()) {
      result.orphaned.push({
        uuid: exchange.id,
        path: exchange.archivePath
      });
    }
  }

  return result;
}

export async function repairIndex(issues: Pick<VerificationResult, 'missing' | 'orphaned' | 'outdated' | 'corrupted'>): Promise<void> {
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
  const toReindex = [...new Set([
    ...issues.missing.map(m => m.path),
    ...issues.outdated.map(o => o.path)
  ])];

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
        const toolNames = exchange.toolCalls?.map(tc => tc.toolName);
        const embedding = await generateExchangeEmbedding(
          exchange.userMessage,
          exchange.assistantMessage,
          toolNames
        );
        insertExchange(db, exchange, embedding, toolNames);
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
