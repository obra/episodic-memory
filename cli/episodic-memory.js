#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn, execSync } from 'child_process';
import { existsSync, realpathSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));

// Main CLI entry point with subcommands
const command = process.argv[2];
const args = process.argv.slice(3);

function checkCommandAvailable(cmd) {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${which} ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runCommand(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
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

async function runTsxCommand(scriptPath, args) {
  if (!checkCommandAvailable('npx')) {
    throw new Error('npx is not available. Please ensure Node.js and npm are installed and in your PATH.');
  }

  if (!existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  await runCommand('npx', ['tsx', scriptPath, ...args]);
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
    switch (command) {
      case 'index':
        // Route to Node.js index-conversations script
        const indexScript = join(__dirname, 'index-conversations.js');
        await runCommand('node', [indexScript, ...args]);
        break;

      case 'search':
        // Route to search implementation
        await runTsxCommand(join(__dirname, '../src/search-cli.ts'), args);
        break;

      case 'show':
        // Route to show implementation
        await runTsxCommand(join(__dirname, '../src/show-cli.ts'), args);
        break;

      case 'stats':
        // Route to stats implementation
        await runTsxCommand(join(__dirname, '../src/stats-cli.ts'), args);
        break;

      case 'sync':
        // Route to sync implementation
        await runTsxCommand(join(__dirname, '../src/sync-cli.ts'), args);
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