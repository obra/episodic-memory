#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { realpathSync } from 'fs';
import { findMissingDeps } from './install-check.js';
import { acquireInstallLock, runNpmInstall, waitForInstallLock } from './install-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');

const command = process.argv[2];
const args = process.argv.slice(3);

// Same self-heal check mcp-server-wrapper.js does before launching the MCP
// server: this dispatcher hits the same externalized deps (dist/summarizer.js
// imports @anthropic-ai/claude-agent-sdk) but had no probe, so a missing
// node_modules (fresh install/update, before the MCP wrapper has run) crashed
// the SessionStart `sync` hook with ERR_MODULE_NOT_FOUND instead of
// self-repairing the way the MCP server path already does.
async function ensureDeps() {
  const missing = findMissingDeps(PLUGIN_ROOT);
  if (missing.length === 0) return;

  console.error(`Missing dependencies under node_modules: ${missing.join(', ')}`);

  const lock = acquireInstallLock(PLUGIN_ROOT);
  if (lock) {
    const install = runNpmInstall(PLUGIN_ROOT, { lockHandle: lock });
    await install.promise;
  } else {
    console.error('Another install is already in progress; waiting for it to finish...');
    await waitForInstallLock(PLUGIN_ROOT);
    const stillMissing = findMissingDeps(PLUGIN_ROOT);
    if (stillMissing.length > 0) {
      console.error(`Still missing after waiting: ${stillMissing.join(', ')}. Continuing anyway.`);
    }
  }
}

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
  console.log(`episodic-memory - Manage and search Claude Code, Codex, and Cursor conversations

USAGE:
  episodic-memory <command> [options]

COMMANDS:
  sync                   Sync conversations from Claude Code, Codex, and Cursor and index them
  index                  Index conversations for search
  search                 Search indexed conversations
  show                   Display a conversation in readable format
  stats                  Show index statistics
  doctor                 Diagnose Claude Code or Codex integration issues
  import-cursor-history  Export legacy Cursor conversations from state.vscdb for indexing

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

    if (command !== '--help' && command !== '-h' && command !== undefined) {
      await ensureDeps();
    }

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

      case 'doctor':
        await runScript(join(distDir, 'doctor-cli.js'), args);
        break;

      case 'sync':
        await runScript(join(distDir, 'sync-cli.js'), args);
        break;

      case 'import-cursor-history':
        await runScript(join(distDir, 'cursor-import-cli.js'), args);
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
