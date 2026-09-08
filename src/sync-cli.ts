import { buildSyncOptionsFromEnv, syncConversations } from './sync.js';
import {
  ConversationSourceHarness,
  getArchiveDir,
  getConversationSourceDirs,
  getIndexDir,
} from './paths.js';
import { shouldSkipReentrantSync } from './summarizer.js';
import { initDatabase } from './db.js';
import { generateExchangeEmbedding, initEmbeddings } from './embeddings.js';
import { runMigrationBatch, countStale } from './embedding-migration.js';
import { exportOpencodeSessions } from './opencode-sync.js';
import { spawn } from 'child_process';
import fs from 'fs';
import { formatLogLine, getSyncLogPath, getSyncLockPath } from './logging.js';
import { acquireFileLock, readLockHolder, releaseFileLock } from './file-lock.js';

const args = process.argv.slice(2);

// Reentrancy guard (#87): if this sync was triggered by a SessionStart hook
// inside a Claude subprocess that the summarizer just spawned, exit silently.
// Without this, summarization spawns a Claude subprocess which fires
// SessionStart which runs sync which spawns more summarization — cascading
// fanout that pegs CPU and burns API quota.
if (shouldSkipReentrantSync()) {
  // stderr keeps the message out of any stdout consumers (e.g., MCP)
  // while still being visible in hook logs.
  console.error('episodic-memory: skipping sync inside summarizer-spawned subprocess (#87)');
  process.exit(0);
}

// Auto-sync off switch (#163): EPISODIC_MEMORY_DISABLE_AUTO_SYNC=1 stops the
// hook-launched background sync entirely, for users who want indexing paused
// without uninstalling. Only the exact string '1' enables it. It intentionally
// gates ONLY the --background (hook/auto) path so an explicit foreground
// `episodic-memory sync` a user runs by hand still works. Complements #159's
// EPISODIC_MEMORY_SKIP_SUMMARIES, which only skips the summary pass.
if (process.env.EPISODIC_MEMORY_DISABLE_AUTO_SYNC === '1' && args.includes('--background')) {
  console.error('episodic-memory: auto-sync disabled via EPISODIC_MEMORY_DISABLE_AUTO_SYNC=1; skipping background sync (#163)');
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: episodic-memory sync [--background] [--only claude|codex|opencode] [--summary-limit N]

Sync conversations from Claude Code, Codex, and opencode transcript sources to archive and index them.

This command:
1. Exports opencode sessions from its SQLite database when available
2. Copies new or updated .jsonl files to conversation archive
3. Generates embeddings for semantic search
4. Updates the search index

Only processes files that are new or have been modified since last sync.
Safe to run multiple times - subsequent runs are fast no-ops.

OPTIONS:
  --background        Run sync in background (for hooks, returns immediately)
  --only <harness>    Limit sync to claude, codex, or opencode
  --summary-limit N   Max summaries to generate per source this run (default: 10)

EXAMPLES:
  # Sync all new conversations
  episodic-memory sync

  # Sync in background (for hooks)
  episodic-memory sync --background

  # Sync only opencode conversations
  episodic-memory sync --only opencode

  # Use in Claude Code hook
  # In .claude/hooks/session-end:
  episodic-memory sync --background
`);
  process.exit(0);
}

// Check if running in background mode
const isBackground = args.includes('--background');

function parseOnlyHarness(): ConversationSourceHarness[] | undefined {
  const raw = (() => {
    const eq = args.find(arg => arg.startsWith('--only='));
    if (eq) return eq.slice('--only='.length);
    const idx = args.indexOf('--only');
    if (idx !== -1) {
      const value = args[idx + 1];
      if (!value || value.startsWith('--')) {
        console.error('Invalid --only value: expected claude, codex, or opencode.');
        process.exit(1);
      }
      return value;
    }
    return undefined;
  })();
  if (!raw) return undefined;

  const harnesses = raw.split(',').map(item => item.trim()).filter(Boolean);
  const valid = new Set(['claude', 'codex', 'opencode']);
  for (const harness of harnesses) {
    if (!valid.has(harness)) {
      console.error(`Invalid --only value: ${harness}. Expected claude, codex, or opencode.`);
      process.exit(1);
    }
  }
  return harnesses as ConversationSourceHarness[];
}

function parseSummaryLimit(): number | undefined {
  const raw = (() => {
    const eq = args.find(arg => arg.startsWith('--summary-limit='));
    if (eq) return eq.slice('--summary-limit='.length);
    const idx = args.indexOf('--summary-limit');
    if (idx !== -1) {
      const value = args[idx + 1];
      if (!value || value.startsWith('--')) {
        console.error('Invalid --summary-limit value: expected a non-negative integer.');
        process.exit(1);
      }
      return value;
    }
    return undefined;
  })();
  if (!raw) return undefined;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(`Invalid --summary-limit value: ${raw}. Expected a non-negative integer.`);
    process.exit(1);
  }
  return parsed;
}

const onlyHarnesses = parseOnlyHarness();
const summaryLimit = parseSummaryLimit();

// If background mode, fork the process and exit immediately
if (isBackground) {
  const filteredArgs = args.filter(arg => arg !== '--background');
  const logPath = getSyncLogPath();
  const logFd = fs.openSync(logPath, 'a');
  fs.writeSync(logFd, formatLogLine('info', `Starting background sync from pid ${process.pid}`));

  // Spawn a detached process
  const child = spawn(process.execPath, [
    process.argv[1], // This script
    ...filteredArgs
  ], {
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });

  child.unref(); // Allow parent to exit
  console.log(`Sync started in background. Log: ${logPath}`);
  process.exit(0);
}

if (!onlyHarnesses || onlyHarnesses.includes('opencode')) {
  const opencodeExport = exportOpencodeSessions();
  if (opencodeExport.exported > 0 || opencodeExport.skipped > 0) {
    console.log(`opencode export: ${opencodeExport.exported} exported, ${opencodeExport.skipped} skipped`);
  }
  if (opencodeExport.errors.length > 0) {
    console.log(`opencode export errors: ${opencodeExport.errors.length}`);
    opencodeExport.errors.forEach(err => {
      const label = err.sessionId ? `session ${err.sessionId}` : 'database';
      console.log(`  ${label}: ${err.error}`);
    });
  }
}

const sourceDirs = getConversationSourceDirs(onlyHarnesses);
const destDir = getArchiveDir();
const syncOptions = buildSyncOptionsFromEnv(process.env);

if (sourceDirs.length === 0) {
  console.log('⚠️  No conversation source directories found.');
  console.log('  Checked: ~/.claude/projects, ~/.claude/transcripts, ~/.codex/sessions, and generated opencode transcripts');
  if (process.env.CLAUDE_CONFIG_DIR) {
    console.log(`  CLAUDE_CONFIG_DIR is set to: ${process.env.CLAUDE_CONFIG_DIR}`);
  }
  process.exit(0);
}

// Single-instance lock (#97). Independent SessionStart events from multiple
// Claude Code sessions each fire `sync --background`; without a lock they race
// the SQLite write path and pile up Claude subprocesses for summarization. On
// Windows the latter exhausts the desktop heap and crashes the workers with
// STATUS_DLL_INIT_FAILED. Acquire after the source-dir check so help/version
// paths don't touch the filesystem unnecessarily, and release on every exit.
const syncLockPath = getSyncLockPath();
const syncLock = acquireFileLock(syncLockPath);
if (!syncLock) {
  const holder = readLockHolder(syncLockPath);
  const holderLabel = holder !== null ? `pid ${holder}` : 'another process';
  console.error(`episodic-memory: sync already running (${holderLabel}); skipping`);
  process.exit(0);
}
const releaseSyncLockOnce = () => {
  if ((releaseSyncLockOnce as any).done) return;
  (releaseSyncLockOnce as any).done = true;
  releaseFileLock(syncLock);
};
process.on('exit', releaseSyncLockOnce);
process.on('SIGINT', () => { releaseSyncLockOnce(); process.exit(130); });
process.on('SIGTERM', () => { releaseSyncLockOnce(); process.exit(143); });
process.on('SIGHUP', () => { releaseSyncLockOnce(); process.exit(129); });

console.log('Syncing conversations...');
console.log(`Sources: ${sourceDirs.join(', ')}`);
console.log(`Destination: ${destDir}\n`);

async function syncAll() {
  const totals = { copied: 0, skipped: 0, indexed: 0, summarized: 0, errors: [] as Array<{file: string; error: string}>, sourcesWithSummaryWork: 0, totalNeedingSummaries: 0 };

  for (const sourceDir of sourceDirs) {
    const result = await syncConversations(sourceDir, destDir, { ...syncOptions, summaryLimit });
    totals.copied += result.copied;
    totals.skipped += result.skipped;
    totals.indexed += result.indexed;
    totals.summarized += result.summarized;
    totals.errors.push(...result.errors);
  }

  console.log(`\n✅ Sync complete!`);
  console.log(`  Copied: ${totals.copied}`);
  console.log(`  Skipped: ${totals.skipped}`);
  console.log(`  Indexed: ${totals.indexed}`);
  if (syncOptions.skipSummaries) {
    console.log('  Summaries: skipped (EPISODIC_MEMORY_SKIP_SUMMARIES=1)');
  } else {
    console.log(`  Summarized: ${totals.summarized}`);
  }

  if (totals.errors.length > 0) {
    console.log(`\n⚠️  Errors: ${totals.errors.length}`);
    totals.errors.forEach(err => console.log(`  ${err.file}: ${err.error}`));

    // Help diagnose silent summarization failures (#70)
    const summaryErrors = totals.errors.filter(e => e.error.startsWith('Summary generation failed'));
    if (summaryErrors.length > 0 && totals.summarized === 0) {
      console.log(`\n💡 All ${summaryErrors.length} summarization attempts failed.`);
      console.log(`  Check your API configuration (EPISODIC_MEMORY_API_BASE_URL / ANTHROPIC_API_KEY).`);
    }
  }

  // After regular sync, do a batch of embedding migration if any rows are
  // still on the old encoder. Lock-protected; if another process is already
  // migrating, this is a no-op.
  await runEmbeddingMigrationPhase();
}

const MIGRATION_BATCH_SIZE = parseInt(process.env.EPISODIC_MEMORY_MIGRATION_BATCH || '500', 10);

async function runEmbeddingMigrationPhase(): Promise<void> {
  const db = initDatabase();
  try {
    const stale = countStale(db);
    if (stale === 0) return;

    console.error(`\nepisodic-memory: ${stale} exchange(s) on the old embedding model — migrating up to ${MIGRATION_BATCH_SIZE} this run`);
    await initEmbeddings();
    const indexDir = getIndexDir();
    const done = await runMigrationBatch(db, indexDir, MIGRATION_BATCH_SIZE, generateExchangeEmbedding);
    if (done > 0) {
      const after = countStale(db);
      console.error(`episodic-memory: re-embedded ${done} (${after} still stale; will resume on next sync)`);
    }
  } catch (err) {
    console.error('episodic-memory: migration phase error:', err instanceof Error ? err.message : err);
  } finally {
    db.close();
  }
}

syncAll().catch(error => {
  console.error('Error syncing:', error);
  process.exit(1);
});
