import { syncConversations } from './sync.js';
import { getArchiveDir, getConversationSourceDirs } from './paths.js';
import { spawn } from 'child_process';
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: episodic-memory sync [--background]

Sync conversations from ~/.claude/projects to archive and index them.

This command:
1. Copies new or updated .jsonl files to conversation archive
2. Generates embeddings for semantic search
3. Updates the search index

Only processes files that are new or have been modified since last sync.
Safe to run multiple times - subsequent runs are fast no-ops.

OPTIONS:
  --background    Run sync in background (for hooks, returns immediately)

EXAMPLES:
  # Sync all new conversations
  episodic-memory sync

  # Sync in background (for hooks)
  episodic-memory sync --background

  # Use in Claude Code hook
  # In .claude/hooks/session-end:
  episodic-memory sync --background
`);
    process.exit(0);
}
// Check if running in background mode
const isBackground = args.includes('--background');
// If background mode, fork the process and exit immediately
if (isBackground) {
    const filteredArgs = args.filter(arg => arg !== '--background');
    // Spawn a detached process
    const child = spawn(process.execPath, [
        process.argv[1], // This script
        ...filteredArgs
    ], {
        detached: true,
        stdio: 'ignore'
    });
    child.unref(); // Allow parent to exit
    console.log('Sync started in background...');
    process.exit(0);
}
const sourceDirs = getConversationSourceDirs();
const destDir = getArchiveDir();
if (sourceDirs.length === 0) {
    console.log('⚠️  No conversation source directories found.');
    console.log('  Checked: ~/.claude/projects and ~/.claude/transcripts');
    if (process.env.CLAUDE_CONFIG_DIR) {
        console.log(`  CLAUDE_CONFIG_DIR is set to: ${process.env.CLAUDE_CONFIG_DIR}`);
    }
    process.exit(0);
}
console.log('Syncing conversations...');
console.log(`Sources: ${sourceDirs.join(', ')}`);
console.log(`Destination: ${destDir}\n`);
async function syncAll() {
    const totals = { copied: 0, skipped: 0, indexed: 0, summarized: 0, errors: [], sourcesWithSummaryWork: 0, totalNeedingSummaries: 0 };
    for (const sourceDir of sourceDirs) {
        const result = await syncConversations(sourceDir, destDir);
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
    console.log(`  Summarized: ${totals.summarized}`);
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
}
syncAll().catch(error => {
    console.error('Error syncing:', error);
    process.exit(1);
});
