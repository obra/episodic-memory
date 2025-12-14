#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { realpathSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));

const child = spawn(process.execPath, [join(__dirname, '../dist/search-cli.js'), ...process.argv.slice(2)], {
  stdio: 'inherit'
});

child.on('exit', (code) => process.exit(code ?? 0));
