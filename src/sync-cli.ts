import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { syncConversations } from './sync.js';
import { syncBoundedSourceDirs } from './bounded-sync.js';
import { getArchiveDir, getConversationSourceDirs, getIndexDir, getSuperpowersDir } from './paths.js';
import { shouldSkipReentrantSync } from './summarizer.js';
import { initDatabase } from './db.js';
import { generateExchangeEmbedding, initEmbeddings } from './embeddings.js';
import { runMigrationBatch, countStale } from './embedding-migration.js';
import { formatLogLine, getSyncLogPath } from './logging.js';
import { authorizeWorkerFromSupervisor, runSyncSupervisor } from './sync-supervisor.js';

const args = process.argv.slice(2);
const isWorker = args.includes('--worker');
const isBackground = args.includes('--background');

if (shouldSkipReentrantSync()) {
  console.error('episodic-memory: skipping sync inside summarizer-spawned subprocess (#87)');
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: episodic-memory sync [--background]

Sync and index conversations through a single lock-supervised worker.
When EPISODIC_MEMORY_ARCHIVE_REMOTE is set, transcripts use the bounded rclone
transport (4 GiB cache, 8 GiB free reserve, 1 GiB/200 files/15 minutes per run).

OPTIONS:
  --background    Start the lock supervisor in background and return
`);
  process.exit(0);
}

if (isBackground && !isWorker) {
  const logPath = getSyncLogPath();
  const logFd = fs.openSync(logPath, 'a');
  fs.writeSync(logFd, formatLogLine('info', `Starting background sync supervisor from pid ${process.pid}`));
  const child = spawn(process.execPath, [process.argv[1], '--supervisor'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  console.log(`Sync supervisor started in background. Log: ${logPath}`);
  process.exit(0);
}

async function main(): Promise<void> {
  if (isWorker) {
    await authorizeWorkerFromSupervisor();
    await runWorker();
    return;
  }

  const lockPath = path.join(path.dirname(getSyncLogPath()), 'episodic-memory-sync.lock');
  const result = await runSyncSupervisor({
    lockPath,
    workerScript: process.argv[1],
    workerArgs: ['--worker'],
    workerStdio: 'inherit',
  });
  if (result.kind === 'skipped') console.error(`episodic-memory: ${result.reason}`);
}

async function runWorker(): Promise<void> {
  const sourceDirs = getConversationSourceDirs();
  if (sourceDirs.length === 0) {
    console.log('No conversation source directories found.');
    return;
  }

  const remoteBase = process.env.EPISODIC_MEMORY_ARCHIVE_REMOTE;
  if (remoteBase) {
    const cacheDir = process.env.EPISODIC_MEMORY_CACHE_DIR ?? path.join(getSuperpowersDir(), 'conversation-cache');
    console.log(`Syncing conversations through bounded rclone transport to ${remoteBase}`);
    const result = await syncBoundedSourceDirs({ sourceDirs, cacheDir, remoteBase });
    console.log('Sync complete');
    console.log(`  Uploaded: ${result.uploaded}`);
    console.log(`  Indexed: ${result.indexed}`);
    console.log(`  Skipped: ${result.skipped}`);
    if (result.boundedStop) console.log(`  Bounded stop: ${result.boundedStop}`);
    for (const error of result.errors) console.error(`  ${error.file}: ${error.error}`);
  } else {
    const destDir = getArchiveDir();
    const totals = { copied: 0, skipped: 0, indexed: 0, summarized: 0, errors: [] as Array<{file:string;error:string}> };
    for (const sourceDir of sourceDirs) {
      const result = await syncConversations(sourceDir, destDir);
      totals.copied += result.copied; totals.skipped += result.skipped;
      totals.indexed += result.indexed; totals.summarized += result.summarized;
      totals.errors.push(...result.errors);
    }
    console.log('Sync complete');
    console.log(`  Copied: ${totals.copied}`);
    console.log(`  Skipped: ${totals.skipped}`);
    console.log(`  Indexed: ${totals.indexed}`);
    console.log(`  Summarized: ${totals.summarized}`);
    for (const error of totals.errors) console.error(`  ${error.file}: ${error.error}`);
  }
  await runEmbeddingMigrationPhase();
}

async function runEmbeddingMigrationPhase(): Promise<void> {
  const db = initDatabase();
  try {
    const stale = countStale(db);
    if (stale === 0) return;
    const batchSize = Number.parseInt(process.env.EPISODIC_MEMORY_MIGRATION_BATCH ?? '500', 10);
    await initEmbeddings();
    await runMigrationBatch(db, getIndexDir(), batchSize, generateExchangeEmbedding);
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error(`Error syncing: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
