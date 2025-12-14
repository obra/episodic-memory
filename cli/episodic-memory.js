#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { realpathSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));

const command = process.argv[2];
const args = process.argv.slice(3);

function runScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit'
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to run command: ${err.message}`));
    });
  });
}

function showHelp() {
  console.log(`episodic-memory - Manage and search Claude Code conversations

USAGE:
  episodic-memory <command> [options]

COMMANDS:
  sync        Sync conversations from ~/.claude/projects and index them
  index       Index conversations for search
  search      Search indexed conversations
  show        Display a conversation in readable format
  stats       Show index statistics

Run 'episodic-memory <command> --help' for command-specific help.

EXAMPLES:
  # Index all conversations
  episodic-memory index --cleanup

  # Search for something
  episodic-memory search "React Router auth"

  # Display a conversation
  episodic-memory show path/to/conversation.jsonl

  # Generate HTML output
  episodic-memory show --format html conversation.jsonl > output.html`);
}

async function main() {
  try {
    const distDir = join(__dirname, '../dist');

    switch (command) {
      case 'index':
        await runScript(join(__dirname, 'index-conversations.js'), args);
        break;

      case 'search':
        await runScript(join(distDir, 'search-cli.js'), args);
        break;

      case 'show':
        await runScript(join(distDir, 'show-cli.js'), args);
        break;

      case 'stats':
        await runScript(join(distDir, 'stats-cli.js'), args);
        break;

      case 'sync':
        await runScript(join(distDir, 'sync-cli.js'), args);
        break;

      case '--help':
      case '-h':
      case undefined:
        showHelp();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Try: episodic-memory --help');
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
