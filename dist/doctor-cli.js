#!/usr/bin/env node
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { buildCodexDoctorReport, buildOpencodeDoctorReport } from './doctor.js';
import { getCodexDir, getOpencodeDbPath, getOpencodeTranscriptDir } from './paths.js';
import { getDbPath } from './paths.js';
import { getSyncLogPath } from './logging.js';
import { detectCodexHookTrustState } from './codex-hook-trust.js';
function capture(command, args) {
    const result = spawnSync(command, args, {
        encoding: 'utf-8',
        timeout: 10000,
    });
    return `${result.stdout || ''}${result.stderr || ''}`.trim();
}
function showHelp() {
    console.log(`Usage: episodic-memory doctor <codex|opencode>

Diagnose local plugin, hook, MCP, archive, and index setup.`);
}
async function main() {
    const target = process.argv[2];
    if (target !== 'codex' && target !== 'opencode') {
        showHelp();
        process.exit(target ? 1 : 0);
    }
    if (target === 'opencode') {
        const dbPath = getOpencodeDbPath();
        const transcriptDir = getOpencodeTranscriptDir();
        const report = buildOpencodeDoctorReport({
            opencodeVersionOutput: capture('opencode', ['--version']),
            debugConfigOutput: capture('opencode', ['debug', 'config']),
            dbPath,
            dbExists: fs.existsSync(dbPath),
            transcriptDir,
            transcriptDirExists: fs.existsSync(transcriptDir),
            logPath: getSyncLogPath(),
        });
        process.stdout.write(report.text);
        process.exit(report.ok ? 0 : 1);
    }
    const codexHome = getCodexDir();
    const hookTrustState = await detectCodexHookTrustState(codexHome, process.cwd());
    const report = buildCodexDoctorReport({
        codexVersionOutput: capture('codex', ['--version']),
        featuresOutput: capture('codex', ['features', 'list']),
        mcpListOutput: capture('codex', ['mcp', 'list']),
        codexHome,
        sessionsDirExists: fs.existsSync(path.join(codexHome, 'sessions')),
        logPath: getSyncLogPath(),
        dbPath: getDbPath(),
        hookTrustState,
    });
    process.stdout.write(report.text);
    process.exit(report.ok ? 0 : 1);
}
main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
