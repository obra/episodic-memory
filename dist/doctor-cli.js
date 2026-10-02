#!/usr/bin/env node
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { buildCodexDoctorReport, buildOpencodeDoctorReport } from './doctor.js';
import { getCodexDir, getOpencodeDbPath, getOpencodeTranscriptDir } from './paths.js';
import { getDbPath } from './paths.js';
import { getSyncLogPath } from './logging.js';
import { detectCodexIntegrationState } from './codex-hook-trust.js';
import { captureNative } from './doctor-observations.js';
function capture(command, args) {
    const result = spawnSync(command, args, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe'],
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
    const env = { ...process.env, CODEX_HOME: codexHome };
    const observationFailures = [];
    const observe = (name, args) => {
        const observed = captureNative('codex', args, env);
        if (observed.failure)
            observationFailures.push(`${name} (${observed.failure})`);
        return observed.output;
    };
    const codexVersionOutput = observe('version', ['--version']);
    const featuresOutput = observe('features', ['features', 'list']);
    const native = await detectCodexIntegrationState(codexHome, process.cwd());
    observationFailures.push(...native.failures);
    const { pluginListOutput, pluginMcpDeclared, hooks } = native;
    // Plugin-provided servers are not in the explicit registration registry.
    // Inspect that fallback only when the native plugin declaration cannot establish configuration.
    const mcpListInspected = pluginMcpDeclared !== true;
    const mcpListOutput = mcpListInspected ? observe('MCP list', ['mcp', 'list']) : '';
    const report = buildCodexDoctorReport({
        codexVersionOutput,
        featuresOutput,
        mcpListOutput,
        pluginListOutput,
        pluginMcpDeclared,
        mcpListInspected,
        observationFailures,
        codexHome,
        sessionsDirExists: fs.existsSync(path.join(codexHome, 'sessions')),
        logPath: getSyncLogPath(),
        dbPath: getDbPath(),
        hookTrustState: hooks.trustState,
        hookEnabledState: hooks.enabledState,
    });
    process.stdout.write(report.text);
    process.exit(report.ok ? 0 : 1);
}
main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
