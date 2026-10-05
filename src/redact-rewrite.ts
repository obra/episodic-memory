import fs from 'fs';
import path from 'path';
import { initDatabase, openDatabaseReadOnly } from './db.js';
import { recordReembedded } from './embedding-migration.js';
import {
  copyFileRedacted,
  describeShape,
  findRedactionTokens,
  FindingsTally,
  redactJsonlLine,
  type RedactionContext,
  type RedactionFinding,
  type Redactor,
} from './redaction.js';

/**
 * Backfill for `episodic-memory redact --rewrite`: re-run redaction over data
 * written before redaction existed (or before a rule was added).
 *
 * 1. Archive: every .jsonl is redacted in place. Line count and mtime are
 *    preserved, so index line ranges stay valid and sync still sees the
 *    archive as current.
 * 2. Staging dirs (opencode / legacy Cursor exports): same, in place.
 * 3. Index: every exchanges/tool_calls row is redacted in place. Changed rows
 *    are re-embedded from the redacted text, so no vector is left that was
 *    derived from a secret.
 * 4. Summaries: a `-summary.txt` for a conversation that had findings (in the
 *    archive or the index), or one that matches a rule itself, is deleted.
 *    It was generated from unredacted text, and the next sync regenerates it
 *    from the redacted archive.
 *
 * Idempotent: a second run finds nothing to change. A dry run opens the index
 * read-only, so it doesn't create, migrate or otherwise touch it.
 */

export type EmbedFn = (user: string, assistant: string, toolNames?: string[]) => Promise<number[]>;

export interface RewriteOptions {
  archiveDir: string;
  redactor: Redactor;
  embed: EmbedFn;
  /** Count what would change without writing anything. */
  dryRun?: boolean;
  /**
   * Called once per value that would be redacted, for reviewing hits before
   * applying them. Never receives the value itself.
   */
  report?: (hit: RedactionHit) => void;
  /** Plugin-owned staging dirs to redact in place (not indexed). */
  stagingDirs?: string[];
  log?: (message: string) => void;
}

export interface RewriteResult {
  filesScanned: number;
  filesRewritten: number;
  stagingFilesRewritten: number;
  rowsUpdated: number;
  summariesRemoved: number;
  /** Rule IDs and counts only — never matched values. */
  findings: RedactionFinding[];
}

/** One redacted value, described without revealing it. */
export interface RedactionHit {
  /** Archive-relative file and 1-based line, or `index:<file>#<exchange id> <field>`. */
  location: string;
  ruleId: string;
  /** Length, character classes and entropy (see describeShape). */
  shape: string;
  /** Redacted text around the token, on one line. */
  context: string;
}

const SUMMARY_SUFFIX = '-summary.txt';
const CONTEXT_BEFORE = 60;
const CONTEXT_AFTER = 20;
const PAGE_SIZE = 500;

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function summaryPathFor(jsonlPath: string): string {
  return jsonlPath.replace(/\.jsonl$/, SUMMARY_SUFFIX);
}

type Match = { ruleId: string; value: string; absorbedBy?: number };

// In report mode each hit is written as its own numbered token, e.g.
// `[REDACTED:jwt--hit3]`, so it can be found in the output exactly; tokens that
// were already in the text have no number. Numbers are stripped for display.
const HIT_TOKEN = /\[REDACTED:([a-z0-9][a-z0-9-]*?)--hit(\d+)\]/g;

/** `value` with any numbered tokens in it replaced by the values they stand for. */
function restoreHits(value: string, matches: Match[]): string {
  return value.replace(HIT_TOKEN, (_token, _ruleId, n: string) => matches[Number(n)].value);
}

/**
 * Report each hit with the redacted text around its token. A hit whose token
 * was swallowed by a later one (a secret field redacted whole after a text rule
 * hit part of it) is reported at the token that swallowed it.
 */
function reportHits(
  redacted: string,
  matches: Match[],
  location: string,
  report: (hit: RedactionHit) => void
): string {
  let display = '';
  let pos = 0;
  const spans = new Map<number, [number, number]>();
  for (const t of findRedactionTokens(redacted)) {
    const numbered = /^(.*)--hit(\d+)$/.exec(t.ruleId);
    display += redacted.slice(pos, t.start);
    const shown = numbered ? `[REDACTED:${numbered[1]}]` : redacted.slice(t.start, t.end);
    if (numbered && !spans.has(Number(numbered[2]))) {
      spans.set(Number(numbered[2]), [display.length, display.length + shown.length]);
    }
    display += shown;
    pos = t.end;
  }
  display += redacted.slice(pos);

  const spanOf = (n: number): [number, number] | undefined => {
    for (let i: number | undefined = n; i !== undefined; i = matches[i].absorbedBy) {
      const span = spans.get(i);
      if (span) return span;
    }
    return undefined;
  };
  const oneLine = (text: string) => text.replace(/\s+/g, ' ');
  const hits = matches.map((m, n) => ({ m, span: spanOf(n) }));
  hits.sort((a, b) => (a.span?.[0] ?? Infinity) - (b.span?.[0] ?? Infinity));
  for (const { m, span } of hits) {
    const [start, end] = span ?? [0, 0];
    const before = display.slice(Math.max(0, start - CONTEXT_BEFORE), start);
    report({
      location,
      ruleId: m.ruleId,
      shape: describeShape(m.value),
      context: span
        ? oneLine(`${start > CONTEXT_BEFORE ? '…' : ''}${before}${display.slice(start, end + CONTEXT_AFTER)}`)
        : '',
    });
  }
  return display;
}

/**
 * Redact with `run`, reporting each hit when `report` is set. Returns
 * the redacted text with ordinary tokens either way.
 */
function redactReporting(
  ctx: RedactionContext,
  location: string,
  report: ((hit: RedactionHit) => void) | undefined,
  run: (ctx: RedactionContext) => string
): string {
  if (!report) return run(ctx);
  const matches: Match[] = [];
  const out = run({
    ...ctx,
    onMatch: (ruleId, value) => {
      const n = matches.length;
      for (const [, , k] of value.matchAll(HIT_TOKEN)) matches[Number(k)].absorbedBy = n;
      matches.push({ ruleId, value: restoreHits(value, matches) });
      return `[REDACTED:${ruleId}--hit${n}]`;
    },
  });
  return matches.length > 0 ? reportHits(out, matches, location, report) : out;
}

/** Report every hit in a JSONL file, line by line. Writes nothing. */
function reportFile(file: string, label: string, redactor: Redactor, report: (hit: RedactionHit) => void): void {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const ctx = { source: 'rewrite', path: file };
  lines.forEach((line, i) => {
    redactReporting(ctx, `${label}:${i + 1}`, report, c => redactJsonlLine(line, redactor, c));
  });
}

/** Redact one JSONL file in place. Returns the number of values redacted. */
function rewriteFileInPlace(file: string, redactor: Redactor, dryRun: boolean, tally: FindingsTally): number {
  const fileTally = new FindingsTally();
  const temp = `${file}.redact.${process.pid}`;
  try {
    copyFileRedacted(file, temp, redactor, { source: 'rewrite', path: file }, fileTally);
    if (fileTally.total > 0 && !dryRun) {
      const stat = fs.statSync(file);
      fs.renameSync(temp, file);
      // Same rounding as sync's copyIfNewer: never leave the archive older than its source.
      fs.utimesSync(file, stat.atimeMs / 1000, Math.ceil(stat.mtimeMs) / 1000);
    }
  } finally {
    try { fs.unlinkSync(temp); } catch {}
  }
  tally.add(fileTally.toArray());
  return fileTally.total;
}

export async function rewriteArchive(options: RewriteOptions): Promise<RewriteResult> {
  const { archiveDir, redactor, embed } = options;
  const dryRun = options.dryRun === true;
  // Reporting reads files before redaction; after a real rewrite there'd be nothing to find.
  if (options.report && !dryRun) throw new Error('rewriteArchive: report requires dryRun');
  const log = options.log ?? (() => {});
  const tally = new FindingsTally();
  const result: RewriteResult = {
    filesScanned: 0,
    filesRewritten: 0,
    stagingFilesRewritten: 0,
    rowsUpdated: 0,
    summariesRemoved: 0,
    findings: [],
  };
  // Conversations whose summary was built from unredacted text.
  const staleSummaries = new Set<string>();

  // 1. Archive files.
  const archiveFiles = walk(archiveDir);
  for (const file of archiveFiles.filter(f => f.endsWith('.jsonl'))) {
    result.filesScanned++;
    if (rewriteFileInPlace(file, redactor, dryRun, tally) > 0) {
      result.filesRewritten++;
      staleSummaries.add(summaryPathFor(file));
      if (options.report) reportFile(file, path.relative(archiveDir, file), redactor, options.report);
    }
  }
  log(`Archive: ${result.filesRewritten} of ${result.filesScanned} file(s) ${dryRun ? 'would be ' : ''}rewritten`);

  // 2. Staging dirs.
  for (const dir of options.stagingDirs ?? []) {
    for (const file of walk(dir).filter(f => f.endsWith('.jsonl'))) {
      if (rewriteFileInPlace(file, redactor, dryRun, tally) > 0) {
        result.stagingFilesRewritten++;
        if (options.report) reportFile(file, `staging:${path.relative(dir, file)}`, redactor, options.report);
      }
    }
  }
  if (options.stagingDirs?.length) {
    log(`Staging exports: ${result.stagingFilesRewritten} file(s) ${dryRun ? 'would be ' : ''}rewritten`);
  }

  // 3. Index rows. Page by rowid so writes between pages don't disturb the scan.
  // A dry run reads the index as it is; opening it normally would migrate it.
  const db = dryRun ? openDatabaseReadOnly() : initDatabase();
  if (db) try {
    const page = db.prepare(
      'SELECT rowid AS rid, id, user_message, assistant_message, archive_path FROM exchanges WHERE rowid > ? ORDER BY rowid LIMIT ?'
    );
    const toolsFor = db.prepare('SELECT id, tool_name, tool_input, tool_result FROM tool_calls WHERE exchange_id = ? ORDER BY rowid');
    const updateExchange = db.prepare('UPDATE exchanges SET user_message = ?, assistant_message = ? WHERE id = ?');
    const updateTool = db.prepare('UPDATE tool_calls SET tool_input = ?, tool_result = ? WHERE id = ?');

    let lastRowid = 0;
    for (;;) {
      const rows = page.all(lastRowid, PAGE_SIZE) as Array<{
        rid: number; id: string; user_message: string; assistant_message: string; archive_path: string;
      }>;
      if (rows.length === 0) break;
      lastRowid = rows[rows.length - 1].rid;

      for (const row of rows) {
        const rowTally = new FindingsTally();
        const ctx = { source: 'index', path: row.archive_path };
        const where = `index:${path.relative(archiveDir, row.archive_path)}#${row.id}`;
        const redactText = (text: string, field: string) =>
          redactReporting(ctx, `${where} ${field}`, options.report, c => {
            const r = redactor.redact(text, c);
            rowTally.add(r.findings);
            return r.text;
          });
        const user = { text: redactText(row.user_message, 'user') };
        const assistant = { text: redactText(row.assistant_message, 'assistant') };

        const tools = toolsFor.all(row.id) as Array<{ id: string; tool_name: string; tool_input: string | null; tool_result: string | null }>;
        const toolUpdates: Array<{ id: string; input: string | null; result: string | null }> = [];
        for (const tool of tools) {
          // tool_input is JSON text; redactJsonlLine keeps it valid JSON.
          const toolInput = tool.tool_input;
          const input = toolInput === null ? null : redactReporting(
            ctx, `${where} ${tool.tool_name} input`, options.report,
            c => redactJsonlLine(toolInput, redactor, c, rowTally)
          );
          const output = tool.tool_result === null ? null : redactText(tool.tool_result, `${tool.tool_name} result`);
          if (input !== tool.tool_input || output !== tool.tool_result) {
            toolUpdates.push({ id: tool.id, input, result: output });
          }
        }

        if (rowTally.total === 0) continue;
        tally.add(rowTally.toArray());
        result.rowsUpdated++;
        staleSummaries.add(summaryPathFor(row.archive_path));
        if (dryRun) continue;

        const toolNames = tools.length > 0 ? tools.map(t => t.tool_name) : undefined;
        const embedding = await embed(user.text, assistant.text, toolNames);
        db.transaction(() => {
          updateExchange.run(user.text, assistant.text, row.id);
          for (const t of toolUpdates) updateTool.run(t.input, t.result, t.id);
          recordReembedded(db, row.id, embedding);
        })();
      }
    }
  } finally {
    db.close();
  }
  log(`Index: ${result.rowsUpdated} exchange(s) ${dryRun ? 'would be ' : ''}redacted and re-embedded`);

  // 4. Summaries: stale ones, plus any summary that itself matches a rule.
  for (const file of archiveFiles.filter(f => f.endsWith(SUMMARY_SUFFIX))) {
    if (staleSummaries.has(file)) continue;
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const r = redactor.redact(text, { source: 'summary', path: file });
    if (r.findings.length > 0) {
      tally.add(r.findings);
      staleSummaries.add(file);
    }
  }
  for (const summary of staleSummaries) {
    if (!fs.existsSync(summary)) continue;
    result.summariesRemoved++;
    if (!dryRun) fs.unlinkSync(summary);
  }
  log(`Summaries: ${result.summariesRemoved} ${dryRun ? 'would be ' : ''}removed (regenerated from redacted text on the next sync)`);

  result.findings = tally.toArray();
  return result;
}
