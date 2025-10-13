import fs from 'fs';
import path from 'path';
import os from 'os';
import { initDatabase, insertExchange } from './db.js';
import { parseConversation } from './parser.js';
import { initEmbeddings, generateExchangeEmbedding } from './embeddings.js';
import { summarizeConversation } from './summarizer.js';
import { ConversationExchange } from './types.js';
import { getArchiveDir, getExcludeConfigPath } from './paths.js';

// Set max output tokens for Claude SDK (used by summarizer)
process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '20000';

// Increase max listeners for concurrent API calls
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 20;

// Allow overriding paths for testing
function getProjectsDir(): string {
  return process.env.TEST_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
}

// Projects to exclude from indexing (configurable via env or config file)
function getExcludedProjects(): string[] {
  // Check env variable first
  if (process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS) {
    return process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS.split(',').map(p => p.trim());
  }

  // Check for config file
  const configPath = getExcludeConfigPath();
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    return content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  }

  // Default: no exclusions
  return [];
}

// Process items in batches with limited concurrency
async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

export async function indexConversations(
  limitToProject?: string,
  maxConversations?: number,
  concurrency: number = 1,
  noSummaries: boolean = false
): Promise<void> {
  console.log('Initializing database...');
  const db = initDatabase();

  console.log('Loading embedding model...');
  await initEmbeddings();

  if (noSummaries) {
    console.log('⚠️  Running in no-summaries mode (skipping AI summaries)');
  }

  console.log('Scanning for conversation files...');
  const PROJECTS_DIR = getProjectsDir();
  const ARCHIVE_DIR = getArchiveDir(); // Now uses paths.ts
  const projects = fs.readdirSync(PROJECTS_DIR);

  let totalExchanges = 0;
  let conversationsProcessed = 0;

  const excludedProjects = getExcludedProjects();

  for (const project of projects) {
    // Skip excluded projects
    if (excludedProjects.includes(project)) {
      console.log(`\nSkipping excluded project: ${project}`);
      continue;
    }

    // Skip if limiting to specific project
    if (limitToProject && project !== limitToProject) continue;
    const projectPath = path.join(PROJECTS_DIR, project);
    const stat = fs.statSync(projectPath);

    if (!stat.isDirectory()) continue;

    const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));

    if (files.length === 0) continue;

    console.log(`\nProcessing project: ${project} (${files.length} conversations)`);
    if (concurrency > 1) console.log(`  Concurrency: ${concurrency}`);

    // Create archive directory for this project
    const projectArchive = path.join(ARCHIVE_DIR, project);
    fs.mkdirSync(projectArchive, { recursive: true });

    // Prepare all conversations first
    type ConvToProcess = {
      file: string;
      sourcePath: string;
      archivePath: string;
      summaryPath: string;
      exchanges: ConversationExchange[];
    };

    const toProcess: ConvToProcess[] = [];

    for (const file of files) {
      const sourcePath = path.join(projectPath, file);
      const archivePath = path.join(projectArchive, file);

      // Copy to archive
      if (!fs.existsSync(archivePath)) {
        fs.copyFileSync(sourcePath, archivePath);
        console.log(`  Archived: ${file}`);
      }

      // Parse conversation
      const exchanges = await parseConversation(sourcePath, project, archivePath);

      if (exchanges.length === 0) {
        console.log(`  Skipped ${file} (no exchanges)`);
        continue;
      }

      toProcess.push({
        file,
        sourcePath,
        archivePath,
        summaryPath: archivePath.replace('.jsonl', '-summary.txt'),
        exchanges
      });
    }

    // Batch summarize conversations in parallel (unless --no-summaries)
    if (!noSummaries) {
      const needsSummary = toProcess.filter(c => !fs.existsSync(c.summaryPath));

      if (needsSummary.length > 0) {
        console.log(`  Generating ${needsSummary.length} summaries (concurrency: ${concurrency})...`);

        await processBatch(needsSummary, async (conv) => {
          try {
            const summary = await summarizeConversation(conv.exchanges);
            fs.writeFileSync(conv.summaryPath, summary, 'utf-8');
            const wordCount = summary.split(/\s+/).length;
            console.log(`  ✓ ${conv.file}: ${wordCount} words`);
            return summary;
          } catch (error) {
            console.log(`  ✗ ${conv.file}: ${error}`);
            return null;
          }
        }, concurrency);
      }
    } else {
      console.log(`  Skipping ${toProcess.length} summaries (--no-summaries mode)`);
    }

    // Now process embeddings and DB inserts (fast, sequential is fine)
    for (const conv of toProcess) {
      for (const exchange of conv.exchanges) {
        const embedding = await generateExchangeEmbedding(
          exchange.userMessage,
          exchange.assistantMessage
        );

        insertExchange(db, exchange, embedding);
      }

      totalExchanges += conv.exchanges.length;
      conversationsProcessed++;

      // Check if we hit the limit
      if (maxConversations && conversationsProcessed >= maxConversations) {
        console.log(`\nReached limit of ${maxConversations} conversations`);
        db.close();
        console.log(`✅ Indexing complete! Conversations: ${conversationsProcessed}, Exchanges: ${totalExchanges}`);
        return;
      }
    }
  }

  db.close();
  console.log(`\n✅ Indexing complete! Conversations: ${conversationsProcessed}, Exchanges: ${totalExchanges}`);
}

export async function indexSession(sessionId: string, concurrency: number = 1, noSummaries: boolean = false): Promise<void> {
  console.log(`Indexing session: ${sessionId}`);

  // Find the conversation file for this session
  const PROJECTS_DIR = getProjectsDir();
  const ARCHIVE_DIR = getArchiveDir(); // Now uses paths.ts
  const projects = fs.readdirSync(PROJECTS_DIR);
  const excludedProjects = getExcludedProjects();
  let found = false;

  for (const project of projects) {
    if (excludedProjects.includes(project)) continue;

    const projectPath = path.join(PROJECTS_DIR, project);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const files = fs.readdirSync(projectPath).filter(f => f.includes(sessionId) && f.endsWith('.jsonl'));

    if (files.length > 0) {
      found = true;
      const file = files[0];
      const sourcePath = path.join(projectPath, file);

      const db = initDatabase();
      await initEmbeddings();

      const projectArchive = path.join(ARCHIVE_DIR, project);
      fs.mkdirSync(projectArchive, { recursive: true });

      const archivePath = path.join(projectArchive, file);

      // Archive
      if (!fs.existsSync(archivePath)) {
        fs.copyFileSync(sourcePath, archivePath);
      }

      // Parse and summarize
      const exchanges = await parseConversation(sourcePath, project, archivePath);

      if (exchanges.length > 0) {
        // Generate summary (unless --no-summaries)
        const summaryPath = archivePath.replace('.jsonl', '-summary.txt');
        if (!noSummaries && !fs.existsSync(summaryPath)) {
          const summary = await summarizeConversation(exchanges);
          fs.writeFileSync(summaryPath, summary, 'utf-8');
          console.log(`Summary: ${summary.split(/\s+/).length} words`);
        }

        // Index
        for (const exchange of exchanges) {
          const embedding = await generateExchangeEmbedding(
            exchange.userMessage,
            exchange.assistantMessage
          );
          insertExchange(db, exchange, embedding);
        }

        console.log(`✅ Indexed session ${sessionId}: ${exchanges.length} exchanges`);
      }

      db.close();
      break;
    }
  }

  if (!found) {
    console.log(`Session ${sessionId} not found`);
  }
}

export async function indexUnprocessed(concurrency: number = 1, noSummaries: boolean = false): Promise<void> {
  console.log('Finding unprocessed conversations...');
  if (concurrency > 1) console.log(`Concurrency: ${concurrency}`);
  if (noSummaries) console.log('⚠️  Running in no-summaries mode (skipping AI summaries)');

  const db = initDatabase();
  await initEmbeddings();

  const PROJECTS_DIR = getProjectsDir();
  const ARCHIVE_DIR = getArchiveDir(); // Now uses paths.ts
  const projects = fs.readdirSync(PROJECTS_DIR);
  const excludedProjects = getExcludedProjects();

  type UnprocessedConv = {
    project: string;
    file: string;
    sourcePath: string;
    archivePath: string;
    summaryPath: string;
    exchanges: ConversationExchange[];
  };

  const unprocessed: UnprocessedConv[] = [];

  // Collect all unprocessed conversations
  for (const project of projects) {
    if (excludedProjects.includes(project)) continue;

    const projectPath = path.join(PROJECTS_DIR, project);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const sourcePath = path.join(projectPath, file);
      const projectArchive = path.join(ARCHIVE_DIR, project);
      const archivePath = path.join(projectArchive, file);
      const summaryPath = archivePath.replace('.jsonl', '-summary.txt');

      // Check if already indexed in database
      const alreadyIndexed = db.prepare('SELECT COUNT(*) as count FROM exchanges WHERE archive_path = ?')
        .get(archivePath) as { count: number };

      if (alreadyIndexed.count > 0) continue;

      fs.mkdirSync(projectArchive, { recursive: true });

      // Archive if needed
      if (!fs.existsSync(archivePath)) {
        fs.copyFileSync(sourcePath, archivePath);
      }

      // Parse and check
      const exchanges = await parseConversation(sourcePath, project, archivePath);
      if (exchanges.length === 0) continue;

      unprocessed.push({ project, file, sourcePath, archivePath, summaryPath, exchanges });
    }
  }

  if (unprocessed.length === 0) {
    console.log('✅ All conversations are already processed!');
    db.close();
    return;
  }

  console.log(`Found ${unprocessed.length} unprocessed conversations`);

  // Batch process summaries (unless --no-summaries)
  if (!noSummaries) {
    const needsSummary = unprocessed.filter(c => !fs.existsSync(c.summaryPath));
    if (needsSummary.length > 0) {
      console.log(`Generating ${needsSummary.length} summaries (concurrency: ${concurrency})...\n`);

      await processBatch(needsSummary, async (conv) => {
        try {
          const summary = await summarizeConversation(conv.exchanges);
          fs.writeFileSync(conv.summaryPath, summary, 'utf-8');
          const wordCount = summary.split(/\s+/).length;
          console.log(`  ✓ ${conv.project}/${conv.file}: ${wordCount} words`);
          return summary;
        } catch (error) {
          console.log(`  ✗ ${conv.project}/${conv.file}: ${error}`);
          return null;
        }
      }, concurrency);
    }
  } else {
    console.log(`Skipping summaries for ${unprocessed.length} conversations (--no-summaries mode)\n`);
  }

  // Now index embeddings
  console.log(`\nIndexing embeddings...`);
  for (const conv of unprocessed) {
    for (const exchange of conv.exchanges) {
      const embedding = await generateExchangeEmbedding(
        exchange.userMessage,
        exchange.assistantMessage
      );
      insertExchange(db, exchange, embedding);
    }
  }

  db.close();
  console.log(`\n✅ Processed ${unprocessed.length} conversations`);
}
