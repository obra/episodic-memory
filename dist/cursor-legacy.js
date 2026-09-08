import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { detectCursorCwd } from './parser.js';
/**
 * Import legacy Cursor conversations from Cursor's global SQLite store
 * (state.vscdb) into JSONL files compatible with the Cursor transcript parser.
 *
 * Cursor only began writing per-session agent transcripts to
 * ~/.cursor/projects in early 2026; older conversations exist solely inside
 * state.vscdb (cursorDiskKV table):
 *
 *   composerData:<composerId>        -> conversation metadata (createdAt,
 *                                       fullConversationHeadersOnly: ordered
 *                                       bubble refs)
 *   bubbleId:<composerId>:<bubbleId> -> one message (type 1=user 2=assistant,
 *                                       text, toolFormerData, createdAt)
 *
 * Exported files embed per-message timestamps, sessionId, and cwd so the
 * parser doesn't need mtime or path heuristics for them.
 */
const VSCDB_CANDIDATES = [
    // macOS
    'Library/Application Support/Cursor/User/globalStorage/state.vscdb',
    // Linux
    '.config/Cursor/User/globalStorage/state.vscdb',
    // Windows
    'AppData/Roaming/Cursor/User/globalStorage/state.vscdb',
];
export function getDefaultCursorVscdbPath() {
    for (const candidate of VSCDB_CANDIDATES) {
        const full = path.join(os.homedir(), candidate);
        if (fs.existsSync(full)) {
            return full;
        }
    }
    return undefined;
}
/**
 * Collect composer IDs that already have live agent transcripts under
 * <cursorDir>/projects/<slug>/agent-transcripts/<uuid>/, so the importer
 * doesn't export conversations sync already picks up from there.
 */
export function collectLiveTranscriptIds(cursorProjectsDir) {
    const ids = new Set();
    if (!fs.existsSync(cursorProjectsDir)) {
        return ids;
    }
    for (const slug of fs.readdirSync(cursorProjectsDir)) {
        const transcriptsDir = path.join(cursorProjectsDir, slug, 'agent-transcripts');
        let entries;
        try {
            entries = fs.readdirSync(transcriptsDir);
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            ids.add(entry);
        }
    }
    return ids;
}
function toIsoTimestamp(value) {
    if (typeof value === 'string' && value) {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
    }
    if (typeof value === 'number' && value > 0) {
        return new Date(value).toISOString();
    }
    return undefined;
}
function parseToolInput(toolFormerData) {
    const raw = toolFormerData?.params ?? toolFormerData?.rawArgs;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        }
        catch {
            return raw;
        }
    }
    return raw;
}
/**
 * Walk up from a detected working directory to the enclosing git repository
 * root when one still exists on disk. The cwd heuristic can land inside a
 * subdirectory (every touched file under <repo>/src yields <repo>/src); the
 * repo root is the meaningful project boundary.
 */
function resolveProjectRoot(dir) {
    let current = dir;
    while (true) {
        if (fs.existsSync(path.join(current, '.git'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return dir;
        }
        current = parent;
    }
}
export function importCursorLegacy(options) {
    const result = {
        exported: 0,
        skippedLive: 0,
        skippedExisting: 0,
        skippedEmpty: 0,
        errors: [],
    };
    const liveIds = options.liveTranscriptIds ?? new Set();
    const db = new Database(options.dbPath, { readonly: true, fileMustExist: true });
    try {
        const composerRows = db
            .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
            .all();
        const bubbleStmt = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
        for (const row of composerRows) {
            const composerId = row.key.split(':', 2)[1];
            try {
                const composer = JSON.parse(String(row.value));
                // Some composerData rows are literal JSON null (abandoned drafts)
                if (!composer) {
                    result.skippedEmpty++;
                    continue;
                }
                const headers = composer.fullConversationHeadersOnly ?? [];
                if (headers.length === 0) {
                    result.skippedEmpty++;
                    continue;
                }
                if (liveIds.has(composerId)) {
                    result.skippedLive++;
                    continue;
                }
                const fallbackTimestamp = toIsoTimestamp(composer.createdAt) ?? new Date(0).toISOString();
                const lines = [];
                const toolInputs = [];
                let lastTimestamp = fallbackTimestamp;
                for (const header of headers) {
                    if (!header?.bubbleId)
                        continue;
                    const bubbleRow = bubbleStmt.get(`bubbleId:${composerId}:${header.bubbleId}`);
                    if (!bubbleRow)
                        continue;
                    let bubble;
                    try {
                        bubble = JSON.parse(String(bubbleRow.value));
                    }
                    catch {
                        continue;
                    }
                    const role = bubble.type === 1 ? 'user' : bubble.type === 2 ? 'assistant' : undefined;
                    if (!role)
                        continue;
                    const timestamp = toIsoTimestamp(bubble.createdAt) ?? lastTimestamp;
                    lastTimestamp = timestamp;
                    const content = [];
                    if (bubble.text && bubble.text.trim()) {
                        content.push({ type: 'text', text: bubble.text });
                    }
                    if (role === 'assistant' && bubble.toolFormerData) {
                        const input = parseToolInput(bubble.toolFormerData);
                        if (input !== undefined && input !== null) {
                            toolInputs.push(input);
                        }
                        content.push({
                            type: 'tool_use',
                            name: bubble.toolFormerData.name ??
                                String(bubble.toolFormerData.tool ?? 'unknown'),
                            input,
                        });
                    }
                    if (content.length === 0)
                        continue;
                    lines.push(JSON.stringify({
                        role,
                        message: { content },
                        timestamp,
                        sessionId: composerId,
                    }));
                }
                if (lines.length === 0) {
                    result.skippedEmpty++;
                    continue;
                }
                let cwd = detectCursorCwd(toolInputs, true);
                if (cwd && fs.existsSync(cwd)) {
                    cwd = resolveProjectRoot(cwd);
                }
                const project = cwd ? path.basename(cwd) : 'cursor-unknown-project';
                const outFile = path.join(options.exportDir, project, `${composerId}.jsonl`);
                if (!options.force && fs.existsSync(outFile)) {
                    result.skippedExisting++;
                    continue;
                }
                if (!options.dryRun) {
                    // Re-serialize with cwd now that it's known (it's derived from the
                    // whole conversation's tool calls).
                    const finalLines = cwd
                        ? lines.map(line => JSON.stringify({ ...JSON.parse(line), cwd }))
                        : lines;
                    fs.mkdirSync(path.dirname(outFile), { recursive: true });
                    fs.writeFileSync(outFile, finalLines.join('\n') + '\n', 'utf-8');
                    // Stamp the conversation's end time so mtime-based fallbacks and
                    // copyIfNewer comparisons reflect when it actually happened.
                    const mtime = toIsoTimestamp(composer.lastUpdatedAt) ?? lastTimestamp;
                    const mtimeDate = new Date(mtime);
                    fs.utimesSync(outFile, mtimeDate, mtimeDate);
                }
                result.exported++;
            }
            catch (error) {
                result.errors.push({
                    composerId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
    finally {
        db.close();
    }
    return result;
}
