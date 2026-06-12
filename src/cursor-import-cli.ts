import path from 'path';
import {
  getDefaultCursorVscdbPath,
  collectLiveTranscriptIds,
  importCursorLegacy,
} from './cursor-legacy.js';
import { getCursorDir, getCursorLegacyExportDir } from './paths.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: episodic-memory import-cursor-history [options]

Export legacy Cursor conversations from Cursor's global SQLite store
(state.vscdb) as JSONL transcripts, so sync can archive and index them.

Cursor only began writing per-session agent transcripts to ~/.cursor/projects
in early 2026; conversations older than that exist only in state.vscdb. This
command backfills them. Conversations that already have a live agent
transcript are skipped automatically.

The export is written to:
  ${getCursorLegacyExportDir()}
which sync scans as a conversation source. Run 'episodic-memory sync' after
importing to archive and index the exported conversations.

The database is opened read-only; Cursor's data is never modified.

OPTIONS:
  --db <path>     Path to state.vscdb (default: auto-detected per platform)
  --out <dir>     Export directory (default: shown above)
  --force         Re-export conversations whose output file already exists
  --dry-run       Report what would be exported without writing files

EXAMPLES:
  # Export all legacy conversations, then index them
  episodic-memory import-cursor-history
  episodic-memory sync

  # Preview without writing
  episodic-memory import-cursor-history --dry-run
`);
  process.exit(0);
}

function argValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

const dbPath = argValue('--db') ?? getDefaultCursorVscdbPath();
if (!dbPath) {
  console.error('Error: could not find Cursor state.vscdb; pass --db <path>');
  process.exit(1);
}

const exportDir = argValue('--out') ?? getCursorLegacyExportDir();
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

const cursorProjectsDir = path.join(getCursorDir(), 'projects');
const liveTranscriptIds = collectLiveTranscriptIds(cursorProjectsDir);

console.log(`Importing legacy Cursor conversations${dryRun ? ' (dry run)' : ''}...`);
console.log(`  Database: ${dbPath}`);
console.log(`  Export dir: ${exportDir}`);
console.log(`  Live transcripts found: ${liveTranscriptIds.size}\n`);

try {
  const result = importCursorLegacy({
    dbPath,
    exportDir,
    liveTranscriptIds,
    force,
    dryRun,
  });

  console.log(`✅ Import ${dryRun ? 'preview' : 'complete'}!`);
  console.log(`  Exported: ${result.exported}`);
  console.log(`  Skipped (live transcript exists): ${result.skippedLive}`);
  console.log(`  Skipped (already exported): ${result.skippedExisting}`);
  console.log(`  Skipped (empty): ${result.skippedEmpty}`);

  if (result.errors.length > 0) {
    console.log(`\n⚠️  Errors: ${result.errors.length}`);
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  ${err.composerId}: ${err.error}`);
    }
  }

  if (!dryRun && result.exported > 0) {
    console.log(`\nRun 'episodic-memory sync' to archive and index the exported conversations.`);
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
