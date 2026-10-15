import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { SUMMARIZER_CONTEXT_MARKER } from './constants.js';
import { getSuperpowersDir } from './paths.js';
const EXCLUSION_MARKERS = [
    '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>',
    'Only use NO_INSIGHTS_FOUND',
    SUMMARIZER_CONTEXT_MARKER,
];
const MARKER_SCAN_CHUNK_BYTES = 1 << 20; // 1 MiB
/** Scan decoded instruction records without retaining the whole transcript. */
export function shouldSkipConversation(filePath) {
    let fd;
    try {
        fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const initial = fs.fstatSync(fd);
        const excluded = descriptorHasExclusionMarker(fd);
        assertUnchangedInput(filePath, initial);
        return excluded;
    }
    catch {
        return true;
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
    }
}
function instructionText(record) {
    if (!object(record))
        return '';
    // Codex records both the response item and its user-message event.
    if (record.type === 'event_msg' && object(record.payload)) {
        return record.payload.type === 'user_message' && typeof record.payload.message === 'string'
            ? record.payload.message : '';
    }
    const message = record.type === 'response_item' ? record.payload : record.message;
    if (!object(message) || (message.role ?? record.role) !== 'user')
        return '';
    const content = record.type === 'opencode_message' ? record.parts : message.content;
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    // Claude tool results are wrapped in a user envelope, but are not instructions.
    return content.filter(part => object(part) && ['text', 'input_text'].includes(String(part.type))
        && typeof part.text === 'string').map(part => part.text).join('\n');
}
function descriptorHasExclusionMarker(fd, byteLimit = Infinity, digest) {
    if (!fs.fstatSync(fd).isFile())
        throw new Error('Conversation input must be a regular file');
    const buffer = Buffer.allocUnsafe(MARKER_SCAN_CHUNK_BYTES);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = Buffer.alloc(0);
    let position = 0;
    const excluded = (bytes) => {
        const line = decoder.decode(bytes);
        let text;
        try {
            text = instructionText(JSON.parse(line));
        }
        catch {
            text = line;
        } // Preserve conservative handling of legacy raw transcripts.
        return EXCLUSION_MARKERS.some(marker => text.includes(marker));
    };
    let count;
    while (position < byteLimit && (count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, byteLimit - position), position)) > 0) {
        position += count;
        digest?.update(buffer.subarray(0, count));
        pending = Buffer.concat([pending, buffer.subarray(0, count)]);
        let newline;
        while ((newline = pending.indexOf(10)) !== -1) {
            if (newline > 64 * 1024 * 1024)
                throw new Error('Conversation record exceeds admission byte limit');
            if (excluded(pending.subarray(0, newline)))
                return true;
            pending = pending.subarray(newline + 1);
        }
        if (pending.length > 64 * 1024 * 1024)
            throw new Error('Conversation record exceeds admission byte limit');
    }
    if (position < byteLimit && byteLimit !== Infinity)
        throw new Error('Conversation changed during record admission');
    return pending.length > 0 && excluded(pending);
}
function assertUnchangedInput(file, initial) {
    const current = fs.lstatSync(file);
    if (!current.isFile() || initial.dev !== current.dev || initial.ino !== current.ino ||
        initial.size !== current.size || initial.mtimeMs !== current.mtimeMs || initial.ctimeMs !== current.ctimeMs) {
        throw new Error('Conversation changed during record admission');
    }
}
function assertUnchangedSearchPrefix(file, initial, expectedDigest) {
    // A live transcript may grow after the search snapshot. Rehash the pinned
    // prefix only when metadata changes, so appended bytes cannot hide a rewrite.
    const changed = () => new Error('Conversation changed during record admission');
    let current;
    try {
        current = fs.lstatSync(file);
    }
    catch {
        throw changed();
    }
    if (!current.isFile() || initial.dev !== current.dev || initial.ino !== current.ino || current.size < initial.size) {
        throw changed();
    }
    if (current.size === initial.size && current.mtimeMs === initial.mtimeMs && current.ctimeMs === initial.ctimeMs)
        return;
    let fd;
    try {
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(fd);
        if (!opened.isFile() || opened.dev !== initial.dev || opened.ino !== initial.ino || opened.size < initial.size)
            throw changed();
        const digest = crypto.createHash('sha256');
        const buffer = Buffer.allocUnsafe(MARKER_SCAN_CHUNK_BYTES);
        let position = 0;
        while (position < initial.size) {
            const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, initial.size - position), position);
            if (count <= 0)
                throw changed();
            digest.update(buffer.subarray(0, count));
            position += count;
        }
        if (digest.digest('hex') !== expectedDigest)
            throw changed();
        current = fs.lstatSync(file);
        if (!current.isFile() || current.dev !== initial.dev || current.ino !== initial.ino || current.size < initial.size)
            throw changed();
    }
    catch {
        throw changed();
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
    }
}
function assertUnchangedPolicy(expected) {
    if (JSON.stringify(readRecordExclusions()) !== expected) {
        throw new Error('Record exclusion policy changed during record admission');
    }
}
function prepareArchiveParent(directory) {
    try {
        const info = fs.lstatSync(directory);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error('Archive parent must be a non-symlink directory');
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
        const parent = path.dirname(directory);
        if (parent === directory)
            throw error;
        prepareArchiveParent(parent);
        fs.mkdirSync(directory, { mode: 0o700 });
    }
    return fs.realpathSync(directory);
}
const POLICY_ERROR = 'Invalid or unreadable record exclusion policy';
const UUID = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/ig;
function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value, expected) {
    return Object.keys(value).length === expected.length && expected.every(key => key in value);
}
function transcriptName(value) {
    return identity(value) && !/[\\/]/.test(value) && value.endsWith('.jsonl') && value !== '.jsonl';
}
function identity(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value);
}
/** Keep scanner inputs local to one record, including JSON-escaped text. */
function screeningText(value, depth = 0) {
    if (depth > 24)
        throw new Error('Record screening nesting limit exceeded');
    if (typeof value === 'string') {
        let decoded;
        try {
            decoded = JSON.parse(value);
        }
        catch {
            return value;
        }
        if (typeof decoded === 'string' || object(decoded) || Array.isArray(decoded)) {
            return screeningText(decoded, depth + 1);
        }
        return value;
    }
    if (Array.isArray(value))
        return value.map(item => screeningText(item, depth + 1)).join('\n');
    if (object(value)) {
        // Generic credential rules need an assignment delimiter, not just a nearby
        // keyword. Decode nested text without destroying its key/value relation.
        return Object.entries(value).map(([key, item]) => `${key} = ${screeningText(item, depth + 1)}`).join('\n');
    }
    return value == null ? '' : String(value);
}
/** One pinned, short-lived local scanner context; no secret-bearing cache. */
function createRecordScreener(policy) {
    const config = policy?.screening;
    if (!config)
        return { scan() { }, close() { } };
    const unavailable = () => new Error('Record screening unavailable');
    let initial;
    let fd;
    try {
        if (fs.realpathSync(config.executable) !== config.executable)
            throw unavailable();
        fd = fs.openSync(config.executable, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        initial = fs.fstatSync(fd);
        if (!initial.isFile() || initial.size < 1 || initial.size > 134_217_728 ||
            (initial.mode & 0o022) !== 0 ||
            (typeof process.getuid === 'function' && initial.uid !== 0 && initial.uid !== process.getuid())) {
            throw unavailable();
        }
        fs.accessSync(config.executable, fs.constants.X_OK);
        const digest = crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex');
        if (digest !== config.sha256)
            throw unavailable();
    }
    catch {
        throw unavailable();
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
    }
    let directory;
    try {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-screen-'));
        fs.chmodSync(directory, 0o700);
    }
    catch {
        throw unavailable();
    }
    const unchanged = () => {
        try {
            const current = fs.lstatSync(config.executable);
            if (!current.isFile() || current.dev !== initial.dev || current.ino !== initial.ino ||
                current.size !== initial.size || current.mtimeMs !== initial.mtimeMs ||
                current.ctimeMs !== initial.ctimeMs)
                throw unavailable();
        }
        catch {
            throw unavailable();
        }
    };
    return {
        scan(value) {
            const raw = typeof value === 'string' ? value : JSON.stringify(value);
            if (raw === undefined)
                return;
            if (Buffer.byteLength(raw) > config.max_record_bytes)
                throw new Error('Record screening byte limit exceeded');
            const input = screeningText(value);
            if (Buffer.byteLength(input) > config.max_record_bytes)
                throw new Error('Record screening byte limit exceeded');
            if (!input.trim())
                return;
            unchanged();
            const result = spawnSync(config.executable, [
                'stdin', '--redact', '--no-banner', '--log-level', 'error',
                '--ignore-gitleaks-allow', '--exit-code', '10', '--report-format', 'json', '--report-path', '-',
            ], {
                input, encoding: 'utf8', cwd: directory, shell: false,
                env: { HOME: directory, USERPROFILE: directory, PATH: path.dirname(config.executable) },
                timeout: config.timeout_ms, killSignal: 'SIGKILL', maxBuffer: 1_048_576,
                windowsHide: true,
            });
            unchanged();
            // Exit zero alone is not a clean scan. Validate the full report and never
            // forward stdout/stderr, findings, fingerprints or input into errors.
            if (result.error || result.signal || ![0, 10].includes(result.status ?? -1))
                throw unavailable();
            let report;
            try {
                report = JSON.parse(result.stdout);
            }
            catch {
                throw unavailable();
            }
            if (!Array.isArray(report) || (result.status === 0 && report.length !== 0) ||
                (result.status === 10 && (report.length === 0 || !report.every(item => object(item) && typeof item.RuleID === 'string')))) {
                throw unavailable();
            }
            if (result.status === 10)
                throw new Error('Record content rejected by screening');
        },
        close() { fs.rmSync(directory, { recursive: true, force: true }); },
    };
}
export function readRecordExclusions() {
    const file = path.join(getSuperpowersDir(), 'record-exclusions.json');
    let fd;
    try {
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const info = fs.fstatSync(fd);
        if (!info.isFile() || info.size > 4 * 1024 * 1024)
            throw new Error(POLICY_ERROR);
        const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
        if (!object(value) || !keys(value, 'screening' in value
            ? ['version', 'exchanges', 'tool_calls', 'screening'] : ['version', 'exchanges', 'tool_calls']) || value.version !== 1 ||
            !Array.isArray(value.exchanges) || !Array.isArray(value.tool_calls))
            throw new Error(POLICY_ERROR);
        if ('screening' in value) {
            const s = value.screening;
            if (!object(s) || !keys(s, ['engine', 'executable', 'sha256', 'timeout_ms', 'max_record_bytes']) ||
                s.engine !== 'gitleaks' || typeof s.executable !== 'string' || !path.isAbsolute(s.executable) ||
                /[\x00-\x1f]/.test(s.executable) || typeof s.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(s.sha256) ||
                !Number.isSafeInteger(s.timeout_ms) || Number(s.timeout_ms) < 50 || Number(s.timeout_ms) > 30_000 ||
                !Number.isSafeInteger(s.max_record_bytes) || Number(s.max_record_bytes) < 1 || Number(s.max_record_bytes) > 8_388_608) {
                throw new Error(POLICY_ERROR);
            }
        }
        for (const row of value.exchanges) {
            if (!object(row) || !keys(row, ['session_id', 'transcript', 'line_start', 'line_end']) || !identity(row.session_id) || !transcriptName(row.transcript) ||
                !Number.isSafeInteger(row.line_start) || !Number.isSafeInteger(row.line_end) ||
                row.line_start < 1 || row.line_end < row.line_start)
                throw new Error(POLICY_ERROR);
        }
        for (const row of value.tool_calls) {
            if (!object(row) || !keys(row, ['session_id', 'transcript', 'call_id']) || !identity(row.session_id) || !transcriptName(row.transcript) || !identity(row.call_id))
                throw new Error(POLICY_ERROR);
        }
        return value;
    }
    catch (error) {
        if (fd === undefined && error.code === 'ENOENT')
            return null;
        throw new Error(POLICY_ERROR);
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
    }
}
export function excludedSession(policy, sessionId) {
    return !!sessionId && !!policy && (policy.exchanges.some(x => x.session_id === sessionId) ||
        policy.tool_calls.some(x => x.session_id === sessionId));
}
function sessionFromPath(file) {
    return path.basename(file).match(UUID)?.at(-1);
}
function sessionFromRecord(value) {
    if (value?.type === 'session_meta')
        return value.payload?.id;
    if (value?.type === 'session')
        return value.id;
    if (value?.type === 'opencode_session')
        return value.session?.id;
    return value?.sessionId ?? value?.sessionID ?? value?.message?.sessionID;
}
function blockedCall(policy, sessionId, transcript, callId) {
    return typeof callId === 'string' && policy.tool_calls.some(x => x.session_id === sessionId && x.transcript === transcript && x.call_id === callId);
}
function filterRecord(line, number, policy, transcript, sessionId) {
    if (!policy || !sessionId)
        return line;
    if (policy.exchanges.some(x => x.session_id === sessionId && x.transcript === transcript && number >= x.line_start && number <= x.line_end))
        return '';
    let value;
    try {
        value = JSON.parse(line);
    }
    catch {
        return line;
    }
    if (blockedCall(policy, sessionId, transcript, value?.payload?.call_id) || blockedCall(policy, sessionId, transcript, value?.call_id))
        return '';
    // Claude and Cursor may combine safe text and tool payloads in one physical record.
    // Preserve the record and safe blocks rather than excluding the entire exchange.
    const content = value?.message?.content;
    if (Array.isArray(content)) {
        const kept = content.filter(block => !blockedCall(policy, sessionId, transcript, block?.id ?? block?.tool_use_id));
        if (kept.length !== content.length) {
            return JSON.stringify({ ...value, message: { ...value.message, content: kept } });
        }
    }
    if (Array.isArray(value?.parts)) {
        const kept = value.parts.filter((part) => !blockedCall(policy, sessionId, transcript, part?.callID ?? part?.id));
        if (kept.length !== value.parts.length)
            return JSON.stringify({ ...value, parts: kept });
    }
    return line;
}
/** Keep byte delimiters and physical line coordinates stable in derived copies. */
async function* admittedRecords(file, policy, startLine = 1, endLine = Infinity) {
    const policySnapshot = JSON.stringify(policy);
    assertUnchangedPolicy(policySnapshot);
    const input = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const initial = fs.fstatSync(input);
    let stream;
    let screener;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = Buffer.alloc(0);
    let sessionId = sessionFromPath(file);
    let primaryIdentitySeen = false;
    let number = 0;
    const admit = (bytes, terminated) => {
        number++;
        const crlf = terminated && bytes.at(-1) === 13;
        const line = decoder.decode(crlf ? bytes.subarray(0, -1) : bytes);
        let recordSession;
        try {
            recordSession = sessionFromRecord(JSON.parse(line));
        }
        catch { /* Parser owns malformed records. */ }
        if (recordSession && !primaryIdentitySeen) {
            if (sessionId && recordSession !== sessionId && (excludedSession(policy, sessionId) || excludedSession(policy, recordSession))) {
                throw new Error('Record exclusion session identity mismatch');
            }
            sessionId = recordSession;
            primaryIdentitySeen = true;
        }
        const filtered = number >= startLine && number <= endLine
            ? filterRecord(line, number, policy, path.basename(file), sessionId) : '';
        screener?.scan(filtered);
        return { line: filtered, ending: terminated ? (crlf ? '\r\n' : '\n') : '' };
    };
    try {
        // The marker scan and record stream share one descriptor and identity.
        // A path replacement cannot substitute a different unscanned transcript.
        if (descriptorHasExclusionMarker(input))
            return;
        assertUnchangedInput(file, initial);
        screener = createRecordScreener(policy);
        stream = fs.createReadStream(file, { fd: input, autoClose: true, start: 0 });
        for await (const chunk of stream) {
            assertUnchangedInput(file, initial);
            assertUnchangedPolicy(policySnapshot);
            pending = Buffer.concat([pending, chunk]);
            let newline;
            while ((newline = pending.indexOf(10)) !== -1) {
                yield admit(pending.subarray(0, newline), true);
                pending = pending.subarray(newline + 1);
            }
            if (pending.length > 64 * 1024 * 1024)
                throw new Error('Conversation record exceeds admission byte limit');
        }
        if (pending.length)
            yield admit(pending, false);
        assertUnchangedInput(file, initial);
        assertUnchangedPolicy(policySnapshot);
    }
    finally {
        if (stream)
            stream.destroy();
        else
            fs.closeSync(input);
        screener?.close();
    }
}
/** Read original inputs without mutation, preserving their physical line numbers. */
export async function* admittedConversationLines(file, policy = readRecordExclusions()) {
    if (!fs.lstatSync(file).isFile())
        throw new Error('Conversation input must be a regular non-symlink file');
    if (shouldSkipConversation(file))
        return;
    for await (const record of admittedRecords(file, policy))
        yield record.line;
}
/** Read the admitted display input without changing original physical coordinates. */
export async function readAdmittedConversation(file, startLine = 1, endLine = Infinity) {
    if (!Number.isSafeInteger(startLine) || startLine < 1 ||
        (endLine !== Infinity && (!Number.isSafeInteger(endLine) || endLine < startLine))) {
        throw new Error('Invalid conversation line range');
    }
    const lines = [];
    for await (const record of admittedRecords(file, readRecordExclusions(), startLine, endLine))
        lines.push(record.line);
    return lines.join('\n');
}
/** Enforce the same rule for direct callers that bypass transcript parsing. */
export function admitExchange(exchange, policy = readRecordExclusions()) {
    if (!policy)
        return exchange;
    // Historical Codex rows may carry a fork ancestor's ID. Neither that metadata
    // nor the filename may override a denial bound to the other known identity.
    const sessionIds = [exchange.sessionId, sessionFromPath(exchange.archivePath)].filter((id) => !!id);
    const transcript = path.basename(exchange.archivePath);
    if (policy.exchanges.some(x => sessionIds.includes(x.session_id) && x.transcript === transcript && exchange.lineStart <= x.line_end && exchange.lineEnd >= x.line_start))
        return null;
    const kept = exchange.toolCalls?.filter(call => !sessionIds.some(id => blockedCall(policy, id, transcript, call.id)));
    const admitted = kept && kept.length !== exchange.toolCalls?.length ? { ...exchange, toolCalls: kept } : exchange;
    const screener = createRecordScreener(policy);
    try {
        // These are separate original records, not one keyword-prefilter fragment.
        screener.scan(admitted.userMessage);
        screener.scan(admitted.assistantMessage);
        for (const call of admitted.toolCalls ?? [])
            screener.scan(call);
        const { userMessage, assistantMessage, toolCalls, ...metadata } = admitted;
        screener.scan(metadata);
        return admitted;
    }
    finally {
        screener.close();
    }
}
/** Publish only admitted bytes. Never write an unfiltered temporary copy. */
export async function archiveAdmittedConversation(source, destination, policy = readRecordExclusions()) {
    const policySnapshot = JSON.stringify(policy);
    assertUnchangedPolicy(policySnapshot);
    if (shouldSkipConversation(source))
        return false;
    if (path.resolve(source) === path.resolve(destination))
        throw new Error('Source and derived archive must be distinct');
    const original = fs.lstatSync(source);
    if (!original.isFile())
        throw new Error('Conversation source must be a regular non-symlink file');
    let target;
    if (fs.existsSync(destination)) {
        target = fs.lstatSync(destination);
        if (!target.isFile() || target.dev === original.dev && target.ino === original.ino) {
            throw new Error('Source and derived archive must be distinct regular files');
        }
    }
    if (!policy && target && target.mtimeMs >= original.mtimeMs && target.size === original.size)
        return false;
    const initial = fs.statSync(source);
    const parent = prepareArchiveParent(path.dirname(path.resolve(destination)));
    const parentIdentity = fs.statSync(parent);
    destination = path.join(parent, path.basename(destination));
    const temp = destination + '.tmp.' + process.pid + '.' + crypto.randomUUID();
    const fd = fs.openSync(temp, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    try {
        for await (const record of admittedRecords(source, policy)) {
            const bytes = Buffer.from(record.line + record.ending);
            hash.update(bytes);
            fs.writeFileSync(fd, bytes);
        }
        fs.fsyncSync(fd);
    }
    catch (error) {
        fs.closeSync(fd);
        fs.unlinkSync(temp);
        throw error;
    }
    fs.closeSync(fd);
    try {
        const final = fs.statSync(source);
        if (initial.dev !== final.dev || initial.ino !== final.ino || initial.size !== final.size || initial.mtimeMs !== final.mtimeMs) {
            throw new Error('Conversation changed during record admission');
        }
        if (fs.existsSync(destination)) {
            const existing = crypto.createHash('sha256');
            for await (const chunk of fs.createReadStream(destination))
                existing.update(chunk);
            if (existing.digest('hex') === hash.digest('hex'))
                return false;
        }
        assertUnchangedInput(source, original);
        assertUnchangedPolicy(policySnapshot);
        const currentParent = fs.lstatSync(parent);
        if (!currentParent.isDirectory() || currentParent.dev !== parentIdentity.dev || currentParent.ino !== parentIdentity.ino) {
            throw new Error('Archive parent changed during record admission');
        }
        fs.renameSync(temp, destination);
        fs.utimesSync(destination, initial.atimeMs / 1000, Math.ceil(initial.mtimeMs) / 1000);
        return true;
    }
    finally {
        if (fs.existsSync(temp))
            fs.unlinkSync(temp);
    }
}
/** Request-local admission: retained search rows are not trusted merely because they were indexed. */
export function createSearchAdmission() {
    const policy = readRecordExclusions();
    const policySnapshot = JSON.stringify(policy);
    const files = new Map();
    const checkFile = (file) => {
        assertUnchangedPolicy(policySnapshot);
        const cached = files.get(file);
        if (cached)
            return !cached.excluded;
        let fd;
        try {
            let pathInfo;
            try {
                pathInfo = fs.lstatSync(file);
            }
            catch (error) {
                // A transcript removed since indexing has nothing left to verify or expose:
                // withhold its retained rows instead of failing the whole search.
                if (error.code !== 'ENOENT')
                    throw error;
                files.set(file, { excluded: true });
                return false;
            }
            if (!pathInfo.isFile())
                throw new Error('Conversation changed during record admission');
            fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            const initial = fs.fstatSync(fd);
            if (!initial.isFile() || initial.dev !== pathInfo.dev || initial.ino !== pathInfo.ino ||
                !Number.isSafeInteger(initial.size))
                throw new Error('Conversation changed during record admission');
            const hash = crypto.createHash('sha256');
            // The observed size is this request's snapshot boundary. Records appended
            // later are admitted by the next request, including conversation opt-outs.
            const excluded = descriptorHasExclusionMarker(fd, initial.size, hash);
            files.set(file, { initial, excluded, digest: excluded ? undefined : hash.digest('hex') });
            return !excluded;
        }
        catch {
            throw new Error('Conversation changed during record admission');
        }
        finally {
            if (fd !== undefined)
                fs.closeSync(fd);
        }
    };
    return {
        admit(exchange) {
            if (!checkFile(exchange.archivePath))
                return null;
            const admitted = admitExchange(exchange, policy);
            assertUnchangedPolicy(policySnapshot);
            return admitted;
        },
        summary(exchange, text) {
            // An old summary has no record-level provenance. A filtered source may have
            // contributed any of its text, so do not expose that derived summary.
            const ids = [exchange.sessionId, sessionFromPath(exchange.archivePath)];
            const transcript = path.basename(exchange.archivePath);
            if (policy && [...policy.exchanges, ...policy.tool_calls].some(row => row.transcript === transcript && ids.includes(row.session_id)))
                return undefined;
            return admitExchange({ ...exchange, userMessage: text, assistantMessage: '', toolCalls: [] }, policy)
                ? text : undefined;
        },
        verify() {
            assertUnchangedPolicy(policySnapshot);
            for (const [file, { initial, digest }] of files) {
                if (initial !== undefined && digest !== undefined)
                    assertUnchangedSearchPrefix(file, initial, digest);
            }
            assertUnchangedPolicy(policySnapshot);
        },
    };
}
