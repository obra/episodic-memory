import { syncConversations } from './sync.js';
import { getArchiveDir } from './paths.js';
import path from 'path';
import os from 'os';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: episodic-memory sync

Sync conversations from ~/.claude/projects to archive and index them.

This command:
1. Copies new or updated .jsonl files to conversation archive
2. Generates embeddings for semantic search
3. Updates the search index

Only processes files that are new or have been modified since last sync.
Safe to run multiple times - subsequent runs are fast no-ops.

Designed for use in session-end hooks to automatically index new conversations.

EXAMPLES:
  # Sync all new conversations
  episodic-memory sync

  # Use in Claude Code hook
  # In .claude/hooks/session-end:
  episodic-memory sync
`);
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
