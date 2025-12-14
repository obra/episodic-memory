#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { realpathSync } from 'fs';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));

function runTsxCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', join(__dirname, '../src/index-cli.ts'), command, ...args], {
      stdio: 'inherit',
      shell: process.platform === 'win32'
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

function askConfirmation(question) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

function showHelp() {
  console.log(`index-conversations - Index and manage conversation archives

USAGE:
  index-conversations [COMMAND] [OPTIONS]

COMMANDS:
  (default)      Index all conversations
  --cleanup      Process only unindexed conversations (fast, cheap)
  --session ID   Index specific session (used by hook)
  --verify       Check index health
  --repair       Fix detected issues
  --rebuild      Delete DB and re-index everything (requires confirmation)

OPTIONS:
  --concurrency N    Parallel summarization (1-16, default: 1)
  -c N               Short form of --concurrency
  --no-summaries     Skip AI summary generation (free, but no summaries in results)
  --help, -h         Show this help

EXAMPLES:
  # Index all unprocessed (recommended for backfill)
  index-conversations --cleanup

  # Index with 8 parallel summarizations (8x faster)
  index-conversations --cleanup --concurrency 8

  # Index without AI summaries (free, fast)
  index-conversations --cleanup --no-summaries

  # Check index health
  index-conversations --verify

  # Fix any issues found
  index-conversations --repair

  # Nuclear option (deletes everything, re-indexes)
  index-conversations --rebuild

WORKFLOW:
  1. Initial setup: index-conversations --cleanup
  2. Ongoing: Auto-indexed by sessionEnd hook
  3. Health check: index-conversations --verify (weekly)
  4. Recovery: index-conversations --repair (if issues found)

SEE ALSO:
  INDEXING.md - Setup and maintenance guide
  DEPLOYMENT.md - Production runbook`);
}

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  try {
    switch (command) {
      case '--help':
      case '-h':
      case undefined:
        if (command === '--help' || command === '-h') {
          showHelp();
          process.exit(0);
        }
        // If no command, fall through to default (index-all)
        await runTsxCommand('index-all', args);
        break;

      case '--session':
        await runTsxCommand('index-session', args);
        break;

      case '--cleanup':
        await runTsxCommand('index-cleanup', args);
        break;

      case '--verify':
        await runTsxCommand('verify', args);
        break;

      case '--repair':
        await runTsxCommand('repair', args);
        break;

      case '--rebuild':
        console.log('⚠️  This will DELETE the entire database and re-index everything.');
        const confirmed = await askConfirmation('Are you sure? [yes/NO]: ');
        if (confirmed) {
          await runTsxCommand('rebuild', args);
        } else {
          console.log('Cancelled');
        }
        break;

      default:
        // Any other argument, treat as index-all with that argument
        await runTsxCommand('index-all', [command, ...args]);
        break;
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