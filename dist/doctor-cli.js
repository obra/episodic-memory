#!/usr/bin/env node
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { buildCodexDoctorReport } from './doctor.js';
import { getCodexDir } from './paths.js';
import { getDbPath } from './paths.js';
import { getSyncLogPath } from './logging.js';
function capture(command, args) {
    const result = spawnSync(command, args, {
        encoding: 'utf-8',
        timeout: 10000,
    });
    return `${result.stdout || ''}${result.stderr || ''}`.trim();
}
function showHelp() {
    console.log(`Usage: episodic-memory doctor codex

Diagnose the local Codex plugin, hook, MCP, archive, and index setup.`);
}
async function main() {
    const target = process.argv[2];
    if (target !== 'codex') {
        showHelp();
        process.exit(target ? 1 : 0);
    }
    const codexHome = getCodexDir();
    const report = buildCodexDoctorReport({
        codexVersionOutput: capture('codex', ['--version']),
        featuresOutput: capture('codex', ['features', 'list']),
        mcpListOutput: capture('codex', ['mcp', 'list']),
        codexHome,
        sessionsDirExists: fs.existsSync(path.join(codexHome, 'sessions')),
        logPath: getSyncLogPath(),
        dbPath: getDbPath(),
    });
    process.stdout.write(report.text);
    process.exit(report.ok ? 0 : 1);
}
main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
