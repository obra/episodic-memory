import { syncConversations } from './sync.js';
import { getArchiveDir } from './paths.js';
import path from 'path';
import os from 'os';
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
const sourceDir = path.join(os.homedir(), '.claude', 'projects');
const destDir = getArchiveDir();
console.log('Syncing conversations...');
console.log(`Source: ${sourceDir}`);
console.log(`Destination: ${destDir}\n`);
syncConversations(sourceDir, destDir)
    .then(result => {
    console.log(`\n✅ Sync complete!`);
    console.log(`  Copied: ${result.copied}`);
    console.log(`  Skipped: ${result.skipped}`);
    console.log(`  Indexed: ${result.indexed}`);
    console.log(`  Summarized: ${result.summarized}`);
    if (result.errors.length > 0) {
        console.log(`\n⚠️  Errors: ${result.errors.length}`);
        result.errors.forEach(err => console.log(`  ${err.file}: ${err.error}`));
    }
})
    .catch(error => {
    console.error('Error syncing:', error);
    process.exit(1);
});
