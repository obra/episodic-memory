import fs from 'fs';
import { getArchiveDir, getCursorLegacyExportDir, getOpencodeTranscriptDir } from './paths.js';
import { acquireFileLock, readLockHolder, releaseFileLock } from './file-lock.js';
import { getSyncLockPath } from './logging.js';
import { DEFAULT_REDACTION_CONFIG, FindingsTally, formatFindings, getRedactionSettings, loadRedactor, redactJsonlLine, } from './redaction.js';
const args = process.argv.slice(2);
const HELP = `
Usage: episodic-memory redact [--rewrite [--dry-run [--report]]] [--stdin] [--print-default-rules]

Secret redaction for the conversation archive and index.

OPTIONS:
  --rewrite              Re-run redaction over the existing archive, staging exports,
                         and search index (in place). Rows that change are re-embedded,
                         and summaries built from unredacted text are deleted (the next
                         sync regenerates them). Run once after upgrading, and again
                         after adding rules.
  --dry-run              With --rewrite: report what would change, write nothing.
                         The index is opened read-only and is not migrated.
  --report               With --rewrite --dry-run: list every value that would be
                         redacted: where it is, the rule, its shape (length,
                         character classes, entropy) and the redacted text around
                         it. Use it to spot false positives before applying.
  --stdin                Redact stdin to stdout, one JSONL/text line at a time, and
                         print rule counts to stderr. Handy for testing rules.
  --print-default-rules  Print the bundled rules as JSON (a starting point for
                         redaction-rules.json).
  --help, -h             Show this help

ENVIRONMENT:
  EPISODIC_MEMORY_REDACTION          on (default) | off
  EPISODIC_MEMORY_REDACTION_RULES    custom rules file (default: <config dir>/redaction-rules.json)
  EPISODIC_MEMORY_REDACTION_STRICT   1 (default) fails closed on a bad rules file | 0 passes through

Output names rule IDs, counts and value shapes only; matched values are never printed.
`;
function fail(message) {
    console.error(`episodic-memory: ${message}`);
    process.exit(1);
}
function requireRedactor() {
    if (!getRedactionSettings().enabled) {
        fail('redaction is off (EPISODIC_MEMORY_REDACTION=off); unset it to use this command.');
    }
    let redactor;
    try {
        // Always strict here: a rewrite with no rules would be a silent no-op.
        redactor = loadRedactor({ ...process.env, EPISODIC_MEMORY_REDACTION_STRICT: '1' });
    }
    catch (error) {
        fail(error instanceof Error ? error.message : String(error));
    }
    return redactor;
}
async function runRewrite(dryRun, report) {
    if (report && !dryRun)
        fail('--report needs --dry-run: review the hits, then apply without it.');
    const redactor = requireRedactor();
    // Share sync's single-instance lock so a background sync can't write
    // between our reads and renames.
    const lockPath = getSyncLockPath();
    const lock = acquireFileLock(lockPath);
    if (!lock) {
        const holder = readLockHolder(lockPath);
        fail(`a sync or index run is in progress (${holder !== null ? `pid ${holder}` : 'another process'}); try again when it finishes.`);
    }
    const release = () => releaseFileLock(lock);
    process.on('exit', release);
    const { rewriteArchive } = await import('./redact-rewrite.js');
    let embeddingsReady = false;
    const embed = async (user, assistant, toolNames) => {
        const embeddings = await import('./embeddings.js');
        if (!embeddingsReady) {
            await embeddings.initEmbeddings();
            embeddingsReady = true;
        }
        return embeddings.generateExchangeEmbedding(user, assistant, toolNames);
    };
    const archiveDir = getArchiveDir();
    const stagingDirs = [getOpencodeTranscriptDir(), getCursorLegacyExportDir()].filter(d => fs.existsSync(d));
    console.log(`Redacting${dryRun ? ' (dry run)' : ''}: ${archiveDir}`);
    for (const dir of stagingDirs)
        console.log(`  + staging: ${dir}`);
    const result = await rewriteArchive({
        archiveDir,
        stagingDirs,
        redactor,
        embed,
        dryRun,
        report: report
            ? hit => console.log(`  ${hit.location}  ${hit.ruleId}  ${hit.shape}
      ${hit.context}`)
            : undefined,
        log: message => console.log(`  ${message}`),
    });
    console.log(`\n${dryRun ? 'Would redact' : 'Redacted'} across archive, staging, and index: ${formatFindings(result.findings)}`);
    if (dryRun && (result.filesRewritten || result.rowsUpdated || result.summariesRemoved || result.stagingFilesRewritten)) {
        console.log('Run without --dry-run to apply.');
    }
}
async function runStdin() {
    const redactor = requireRedactor();
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(chunk);
    const input = Buffer.concat(chunks).toString('utf-8');
    const tally = new FindingsTally();
    const output = input.split('\n').map(line => redactJsonlLine(line, redactor, { source: 'stdin', path: '-' }, tally));
    process.stdout.write(output.join('\n'));
    console.error(formatFindings(tally.toArray()));
}
async function main() {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(HELP);
        return;
    }
    if (args.includes('--print-default-rules')) {
        console.log(JSON.stringify(DEFAULT_REDACTION_CONFIG, null, 2));
        return;
    }
    if (args.includes('--stdin')) {
        await runStdin();
        return;
    }
    if (args.includes('--rewrite')) {
        await runRewrite(args.includes('--dry-run'), args.includes('--report'));
        return;
    }
    fail(`unknown option(s): ${args.join(' ')}. Try: episodic-memory redact --help`);
}
main().catch(error => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
});
