#!/usr/bin/env node
/**
 * Cross-platform wrapper script for MCP server that ensures dependencies are installed
 * This runs before the MCP server starts and works on Windows, macOS, and Linux
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { findMissingDeps } from './install-check.js';
import { acquireInstallLock, runNpmInstall, waitForInstallLock } from './install-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine plugin root directory
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');

async function main() {
  try {
    // Probe each required runtime dependency's package.json — not just the
    // node_modules directory. A partial extraction (folder exists but the
    // package is missing its manifest and lib/) would slip past an existsSync
    // check on node_modules alone and crash the server with ERR_MODULE_NOT_FOUND
    // *after* the wrapper has handed off to dist/mcp-server.js (#95 Bug 1).
    const missing = findMissingDeps(PLUGIN_ROOT);
    if (missing.length > 0) {
      console.error(`Missing dependencies under node_modules: ${missing.join(', ')}`);

      // Single-flight: a second wrapper launched while one is already
      // installing must not start a competing install (#161) — repeated
      // wrapper launches within the client's connect-timeout window would
      // otherwise stack unbounded concurrent `npm install`s.
      const lock = acquireInstallLock(PLUGIN_ROOT);
      if (lock) {
        const install = runNpmInstall(PLUGIN_ROOT, { lockHandle: lock });
        await install.promise;
      } else {
        console.error('Another install is already in progress; waiting for it to finish...');
        await waitForInstallLock(PLUGIN_ROOT);
        // Re-probe: the other install may have completed the deps by now.
        const stillMissing = findMissingDeps(PLUGIN_ROOT);
        if (stillMissing.length > 0) {
          console.error(`Still missing after waiting: ${stillMissing.join(', ')}. Continuing anyway.`);
        }
      }
    }

    // Start the MCP server
    const mcpServerPath = join(PLUGIN_ROOT, 'dist', 'mcp-server.js');

    if (!existsSync(mcpServerPath)) {
      console.error(`ERROR: MCP server not found at ${mcpServerPath}`);
      console.error('Please run: npm run build');
      process.exit(1);
    }

    // Use spawn with shell: false for better cross-platform compatibility
    const child = spawn(process.execPath, [mcpServerPath], {
      stdio: 'inherit',
      shell: false
    });

    // Forward signals to the child process
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGHUP', () => child.kill('SIGHUP'));

    // Detect parent process death via stdin close
    // When Claude exits (normally or abnormally), stdin will close
    process.stdin.on('end', () => {
      child.kill();
      process.exit(0);
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exit(code || 0);
      }
    });

    child.on('error', (err) => {
      console.error(`ERROR: Failed to start MCP server: ${err.message}`);
      process.exit(1);
    });

  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
