import fs from 'fs';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import { getSuperpowersDir } from './paths.js';
import { DEFAULT_REDACTION_CONFIG } from './redaction-rules.js';

/**
 * Inline secret redaction.
 *
 * Secrets are replaced with typed tokens (`[REDACTED:<ruleId>]`) at the archive
 * write, the one point every harness's transcripts pass through (see
 * docs/REDACTION.md). Everything downstream (SQLite text,
 * tool_calls, embeddings, summaries, show/read) reads the archive, so it only
 * ever sees redacted text.
 *
 * Invariants:
 * - Findings carry rule IDs and counts only. A matched value is never logged,
 *   returned, or thrown.
 * - Idempotent: a `[REDACTED:...]` token never matches a rule, so redacting
 *   redacted text is a no-op.
 * - JSONL structure is preserved: one output line per input line, valid JSON in
 *   gives valid JSON out, and unchanged lines are byte-identical.
 */

export { DEFAULT_REDACTION_CONFIG };

/** Fork default. Flip to false for an opt-in upstream build. */
export const REDACTION_ENABLED_BY_DEFAULT = true;

export const REDACTION_RULES_FILENAME = 'redaction-rules.json';

const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const TOKEN_PATTERN = /\[REDACTED:[a-z0-9][a-z0-9-]*\]/g;
const TOKEN_PREFIX = '[REDACTED:';
const ALLOWED_FLAGS = /^[imsu]*$/;
const ENTROPY_RULE_ID = 'high-entropy';
const FIELD_RULE_ID = 'secret-field';
const RESERVED_IDS = new Set([ENTROPY_RULE_ID, FIELD_RULE_ID]);

/** Values that are templates or type names, not secrets. Never redacted by field context. */
const PLACEHOLDER_VALUE =
  /^(?:\$\{.*\}|\$\(.*\)|\$[A-Za-z_]\w*|#\{.*\}#?|\{\{.*\}\}|<[^>]*>|%[A-Za-z_]\w*%|__[A-Za-z0-9_]+__|string|null|true|false|none|undefined|\*+)$/i;
const KEY_VAULT_SECRET_ID = /^https:\/\/[^/\s]+\.vault\.(?:azure\.net|azure\.cn|usgovcloudapi\.net|microsoftazure\.de)\/secrets\//i;

export interface RedactionRuleSpec {
  id: string;
  pattern: string;
  /** Extra RegExp flags from [imsu]; `g` and `d` are always added. */
  flags?: string;
  /** Case-insensitive prefilter: skip the rule unless the text contains one. */
  keywords?: string[];
  /**
   * Replace only this capture group instead of the whole match. An array means
   * "the first of these groups that participated" (for either-order patterns).
   */
  secretGroup?: number | number[];
  /** Apply the allowlist to this rule's matches (default true). Key-context rules turn it off: a GUID in a password slot is a secret. */
  useAllowlist?: boolean;
  description?: string;
}

export interface AllowlistSpec {
  id: string;
  /** Matched against the whole candidate secret; a full match keeps it. */
  pattern: string;
  flags?: string;
  description?: string;
}

export interface EntropySpec {
  enabled: boolean;
  minLength: number;
  /** Shannon entropy in bits per character. */
  threshold: number;
  /** Only fire when a keyword appears shortly before the candidate, on the same line. */
  requireKeyword: boolean;
  keywords: string[];
  /** How many characters before the candidate to search for a keyword. */
  window: number;
}

/**
 * Field-name context for parsed JSON (transcript lines, structured tool/MCP
 * results, tool inputs). A string value is redacted whole when its own key, or
 * the `name`/`key` of a `{name, value}` pair, matches `keyPattern`.
 */
export interface SecretFieldsSpec {
  enabled: boolean;
  /**
   * Matched (anchored at the end) against the key lowercased with everything
   * but letters and digits removed and trailing digits dropped, so
   * `AzureAd:ClientSecret`, `client_secret` and `DB_PASSWORD2` all normalize to
   * something ending in a keyword.
   */
  keyPattern: string;
}

export interface RedactionConfig {
  rules: RedactionRuleSpec[];
  allowlist: AllowlistSpec[];
  entropy: EntropySpec;
  secretFields: SecretFieldsSpec;
}

/** Shape of a user `redaction-rules.json`. Every field is optional. */
export interface RedactionRulesFile {
  /** Merge with the bundled defaults (default true). */
  includeDefaults?: boolean;
  /** Added after the defaults; a rule with a default's id replaces it in place. */
  rules?: RedactionRuleSpec[];
  /** Default rule ids to turn off. */
  disableRules?: string[];
  /** Added to the default allowlist (same id replaces). */
  allowlist?: AllowlistSpec[];
  entropy?: Partial<EntropySpec>;
  secretFields?: Partial<SecretFieldsSpec>;
}

export interface RedactionContext {
  source: string;
  path: string;
  /**
   * Called with each value as it is redacted. For local review tooling
   * (`redact --report`) only: the value is the secret itself, so never log it.
   * May return the token to write instead of `[REDACTED:<ruleId>]`, e.g. one
   * numbered per hit; it must still have the token's shape.
   */
  onMatch?: (ruleId: string, value: string) => string | void;
}

export interface RedactionFinding {
  ruleId: string;
  count: number;
}

export interface RedactionResult {
  text: string;
  findings: RedactionFinding[];
}

export interface Redactor {
  redact(text: string, ctx?: RedactionContext): RedactionResult;
  readonly ruleIds: string[];
  /** True when a JSON key / setting name marks its value as a secret (secretFields). */
  isSecretField(name: string): boolean;
}

export interface RedactionSettings {
  enabled: boolean;
  strict: boolean;
  /** Explicit EPISODIC_MEMORY_REDACTION_RULES path, if set. */
  rulesPath?: string;
}

/** Rules could not be loaded or are invalid. Messages describe config only. */
export class RedactionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedactionConfigError';
  }
}

// ---------------------------------------------------------------------------
// Settings and loading
// ---------------------------------------------------------------------------

const OFF_VALUES = new Set(['off', '0', 'false', 'no', 'disabled']);
const ON_VALUES = new Set(['on', '1', 'true', 'yes', 'enabled']);

/** Unknown values fall back to the default, which is the safe side for both switches. */
function parseToggle(raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if (OFF_VALUES.has(value)) return false;
  if (ON_VALUES.has(value)) return true;
  return fallback;
}

/**
 * EPISODIC_MEMORY_REDACTION         on (fork default) | off
 * EPISODIC_MEMORY_REDACTION_RULES   path to a custom rules file
 * EPISODIC_MEMORY_REDACTION_STRICT  1 (default) | 0; strict fails closed on a rules-load error
 */
export function getRedactionSettings(env: NodeJS.ProcessEnv = process.env): RedactionSettings {
  return {
    enabled: parseToggle(env.EPISODIC_MEMORY_REDACTION, REDACTION_ENABLED_BY_DEFAULT),
    strict: parseToggle(env.EPISODIC_MEMORY_REDACTION_STRICT, true),
    rulesPath: env.EPISODIC_MEMORY_REDACTION_RULES || undefined,
  };
}

function readRulesFile(settings: RedactionSettings): RedactionRulesFile {
  let rulesPath = settings.rulesPath;
  if (!rulesPath) {
    const candidate = path.join(getSuperpowersDir(), REDACTION_RULES_FILENAME);
    if (!fs.existsSync(candidate)) return {};
    rulesPath = candidate;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(rulesPath, 'utf-8');
  } catch (error) {
    throw new RedactionConfigError(
      `Redaction rules failed to load from ${rulesPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  try {
    return JSON.parse(raw) as RedactionRulesFile;
  } catch (error) {
    throw new RedactionConfigError(
      `Redaction rules file ${rulesPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function replaceById<T extends { id: string }>(base: T[], additions: T[]): T[] {
  const out = [...base];
  for (const item of additions) {
    const at = out.findIndex(existing => existing.id === item.id);
    if (at >= 0) out[at] = item;
    else out.push(item);
  }
  return out;
}

/**
 * Merge a rules file with the bundled defaults and validate the result.
 * Throws RedactionConfigError on any invalid rule.
 */
export function loadRedactionConfig(file: RedactionRulesFile): RedactionConfig {
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    throw new RedactionConfigError('Redaction rules file must contain a JSON object');
  }
  for (const key of ['rules', 'allowlist', 'disableRules'] as const) {
    if (file[key] !== undefined && !Array.isArray(file[key])) {
      throw new RedactionConfigError(`Redaction rules file: "${key}" must be an array`);
    }
  }
  for (const key of ['entropy', 'secretFields'] as const) {
    if (file[key] !== undefined && (typeof file[key] !== 'object' || file[key] === null || Array.isArray(file[key]))) {
      throw new RedactionConfigError(`Redaction rules file: "${key}" must be an object`);
    }
  }

  const includeDefaults = file.includeDefaults !== false;
  const disabled = new Set(file.disableRules ?? []);
  const baseRules = includeDefaults ? DEFAULT_REDACTION_CONFIG.rules : [];
  const baseAllowlist = includeDefaults ? DEFAULT_REDACTION_CONFIG.allowlist : [];

  const config: RedactionConfig = {
    rules: replaceById(baseRules, file.rules ?? []).filter(rule => !disabled.has(rule.id)),
    allowlist: replaceById(baseAllowlist, file.allowlist ?? []),
    entropy: { ...DEFAULT_REDACTION_CONFIG.entropy, ...(file.entropy ?? {}) },
    secretFields: { ...DEFAULT_REDACTION_CONFIG.secretFields, ...(file.secretFields ?? {}) },
  };
  compileConfig(config); // validate
  return config;
}

/**
 * Load the active redactor from the environment.
 *
 * Returns null when redaction is off. When the rules can't be loaded: strict
 * mode (the default) throws RedactionConfigError so callers fail closed;
 * non-strict mode warns and returns null, so text passes through unredacted.
 */
export function loadRedactor(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = message => console.error(message)
): Redactor | null {
  const settings = getRedactionSettings(env);
  if (!settings.enabled) return null;
  try {
    return createRedactor(loadRedactionConfig(readRulesFile(settings)));
  } catch (error) {
    const err = error instanceof RedactionConfigError
      ? error
      : new RedactionConfigError(`Redaction rules failed to load: ${error instanceof Error ? error.message : String(error)}`);
    if (settings.strict) throw err;
    warn(
      `episodic-memory: ${err.message}. EPISODIC_MEMORY_REDACTION_STRICT=0, so conversations ` +
      'will be archived and indexed WITHOUT redaction this run.'
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

interface CompiledRule {
  id: string;
  regex: RegExp;
  keywords?: string[];
  secretGroups: number[];
  useAllowlist: boolean;
}

interface CompiledConfig {
  rules: CompiledRule[];
  allowlist: RegExp[];
  entropy: EntropySpec;
  /** null when secretFields is disabled. */
  secretField: RegExp | null;
}

function checkFlags(flags: string | undefined, what: string): string {
  const value = flags ?? '';
  if (typeof value !== 'string' || !ALLOWED_FLAGS.test(value)) {
    throw new RedactionConfigError(`${what}: flags must be a combination of "imsu"`);
  }
  return value;
}

function compileRule(spec: RedactionRuleSpec): CompiledRule {
  if (!spec || typeof spec !== 'object') {
    throw new RedactionConfigError('Redaction rule must be an object');
  }
  if (typeof spec.id !== 'string' || !RULE_ID_PATTERN.test(spec.id)) {
    throw new RedactionConfigError(
      `Redaction rule id ${JSON.stringify(spec.id)} is invalid: use lowercase letters, digits and dashes`
    );
  }
  if (RESERVED_IDS.has(spec.id)) {
    throw new RedactionConfigError(`Redaction rule id "${spec.id}" is reserved`);
  }
  const what = `Redaction rule "${spec.id}"`;
  if (typeof spec.pattern !== 'string' || spec.pattern.length === 0) {
    throw new RedactionConfigError(`${what}: pattern must be a non-empty string`);
  }
  const flags = checkFlags(spec.flags, what);

  let regex: RegExp;
  let groupCount: number;
  try {
    regex = new RegExp(spec.pattern, flags + 'gd');
    groupCount = new RegExp(`(?:${spec.pattern})|`, flags).exec('')!.length - 1;
  } catch (error) {
    throw new RedactionConfigError(`${what}: invalid regular expression (${error instanceof Error ? error.message : String(error)})`);
  }
  if (new RegExp(spec.pattern, flags).test('')) {
    throw new RedactionConfigError(`${what}: pattern matches the empty string`);
  }

  const secretGroups = Array.isArray(spec.secretGroup) ? spec.secretGroup : [spec.secretGroup ?? 0];
  if (secretGroups.length === 0) {
    throw new RedactionConfigError(`${what}: secretGroup must not be an empty array`);
  }
  for (const group of secretGroups) {
    if (!Number.isInteger(group) || group < 0 || group > groupCount) {
      throw new RedactionConfigError(`${what}: secretGroup ${group} does not exist in the pattern (${groupCount} group(s))`);
    }
  }
  if (spec.useAllowlist !== undefined && typeof spec.useAllowlist !== 'boolean') {
    throw new RedactionConfigError(`${what}: useAllowlist must be a boolean`);
  }

  let keywords: string[] | undefined;
  if (spec.keywords !== undefined) {
    if (!Array.isArray(spec.keywords) || spec.keywords.some(k => typeof k !== 'string' || k.length === 0)) {
      throw new RedactionConfigError(`${what}: keywords must be an array of non-empty strings`);
    }
    keywords = spec.keywords.length > 0 ? spec.keywords.map(k => k.toLowerCase()) : undefined;
  }

  return { id: spec.id, regex, keywords, secretGroups, useAllowlist: spec.useAllowlist !== false };
}

function compileAllowlist(spec: AllowlistSpec): RegExp {
  const what = `Redaction allowlist entry ${JSON.stringify(spec?.id)}`;
  if (!spec || typeof spec.pattern !== 'string' || spec.pattern.length === 0) {
    throw new RedactionConfigError(`${what}: pattern must be a non-empty string`);
  }
  const flags = checkFlags(spec.flags, what);
  try {
    return new RegExp(`^(?:${spec.pattern})$`, flags);
  } catch (error) {
    throw new RedactionConfigError(`${what}: invalid regular expression (${error instanceof Error ? error.message : String(error)})`);
  }
}

function compileConfig(config: RedactionConfig): CompiledConfig {
  const seen = new Set<string>();
  const rules = config.rules.map(spec => {
    const rule = compileRule(spec);
    if (seen.has(rule.id)) throw new RedactionConfigError(`Duplicate redaction rule id "${rule.id}"`);
    seen.add(rule.id);
    return rule;
  });
  const allowlist = config.allowlist.map(compileAllowlist);

  const e = config.entropy;
  if (
    typeof e.enabled !== 'boolean' || typeof e.requireKeyword !== 'boolean' ||
    !Number.isInteger(e.minLength) || e.minLength < 8 ||
    typeof e.threshold !== 'number' || !(e.threshold > 0) ||
    !Number.isInteger(e.window) || e.window < 0 ||
    !Array.isArray(e.keywords) || e.keywords.some(k => typeof k !== 'string' || !k)
  ) {
    throw new RedactionConfigError(
      'Redaction entropy settings are invalid (need enabled, requireKeyword: boolean; minLength >= 8; threshold > 0; window >= 0; keywords: string[])'
    );
  }
  const f = config.secretFields;
  if (!f || typeof f.enabled !== 'boolean' || typeof f.keyPattern !== 'string' || f.keyPattern.length === 0) {
    throw new RedactionConfigError('Redaction secretFields settings are invalid (need enabled: boolean; keyPattern: non-empty string)');
  }
  let secretField: RegExp | null = null;
  if (f.enabled) {
    try {
      secretField = new RegExp(`(?:${f.keyPattern})$`);
    } catch (error) {
      throw new RedactionConfigError(`Redaction secretFields.keyPattern: invalid regular expression (${error instanceof Error ? error.message : String(error)})`);
    }
    if (secretField.test('')) throw new RedactionConfigError('Redaction secretFields.keyPattern matches the empty string');
  }

  return { rules, allowlist, entropy: { ...e, keywords: e.keywords.map(k => k.toLowerCase()) }, secretField };
}

// ---------------------------------------------------------------------------
// Redaction engine
// ---------------------------------------------------------------------------

function tokenFor(ruleId: string): string {
  return `${TOKEN_PREFIX}${ruleId}]`;
}

const WHOLE_TOKEN = /^\[REDACTED:[a-z0-9][a-z0-9-]*\]$/;

/** The token for one redacted value: onMatch's, if it returns a valid one. */
function tokenForMatch(ruleId: string, value: string, onMatch: RedactionContext['onMatch']): string {
  const custom = onMatch?.(ruleId, value);
  return typeof custom === 'string' && WHOLE_TOKEN.test(custom) ? custom : tokenFor(ruleId);
}

function tokenSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(TOKEN_PATTERN)) spans.push([m.index!, m.index! + m[0].length]);
  return spans;
}

function overlapsAny(spans: Array<[number, number]>, start: number, end: number): boolean {
  for (const [s, e] of spans) if (start < e && end > s) return true;
  return false;
}

/**
 * Rewrite text[start, end) keeping the existing tokens in it and replacing each
 * stretch between them that has a letter or digit with `token`. Returns null
 * when nothing outside the tokens needs redacting, which keeps this idempotent.
 */
function redactAroundTokens(
  text: string,
  spans: Array<[number, number]>,
  start: number,
  end: number,
  token: () => string
): string | null {
  let out = '';
  let pos = start;
  let replaced = false;
  const flush = (to: number) => {
    const piece = text.slice(pos, to);
    if (/[A-Za-z0-9]/.test(piece)) {
      out += token();
      replaced = true;
    } else {
      out += piece;
    }
  };
  for (const [s, e] of spans) {
    if (e <= start || s >= end) continue;
    if (s > pos) flush(s);
    out += text.slice(Math.max(s, pos), Math.min(e, end));
    pos = Math.min(e, end);
  }
  if (pos < end) flush(end);
  return replaced ? out : null;
}

/**
 * Describe a value without revealing it: length, character classes and
 * Shannon entropy (bits per char), e.g. "len=40 aA9- H=4.9". Lets someone
 * reviewing hits tell a random key from a word or a placeholder.
 */
export function describeShape(value: string): string {
  const classes =
    (/[a-z]/.test(value) ? 'a' : '') +
    (/[A-Z]/.test(value) ? 'A' : '') +
    (/[0-9]/.test(value) ? '9' : '') +
    (/[^A-Za-z0-9\s]/.test(value) ? '-' : '') +
    (/\s/.test(value) ? '_' : '');
  return `len=${value.length} ${classes || '?'} H=${shannonEntropy(value).toFixed(1)}`;
}

/** Each `[REDACTED:<ruleId>]` token in `text`, left to right. */
export function findRedactionTokens(text: string): Array<{ ruleId: string; start: number; end: number }> {
  const out: Array<{ ruleId: string; start: number; end: number }> = [];
  for (const m of text.matchAll(TOKEN_PATTERN)) {
    out.push({ ruleId: m[0].slice(TOKEN_PREFIX.length, -1), start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

function shannonEntropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Replace each accepted match (or its secretGroup) with a token. A candidate
 * that overlaps existing tokens keeps them, and only the text around them is
 * redacted (so re-running is a no-op). A candidate is skipped when it fully
 * matches an allowlist pattern.
 */
function applyRule(
  text: string,
  rule: CompiledRule,
  isAllowed: (s: string) => boolean,
  onMatch?: RedactionContext['onMatch']
): { text: string; count: number } {
  const spans = text.includes(TOKEN_PREFIX) ? tokenSpans(text) : null;
  let out = '';
  let last = 0;
  let count = 0;
  for (const m of text.matchAll(rule.regex)) {
    let range: [number, number] | undefined;
    for (const group of rule.secretGroups) {
      range = m.indices?.[group];
      if (range) break;
    }
    if (!range) continue;
    const [start, end] = range;
    if (end <= start || start < last) continue;
    if (rule.useAllowlist && isAllowed(text.slice(start, end))) continue;
    if (spans && overlapsAny(spans, start, end)) {
      let token: string | undefined;
      const rewritten = redactAroundTokens(text, spans, start, end, () =>
        (token ??= tokenForMatch(rule.id, text.slice(start, end).replace(TOKEN_PATTERN, ''), onMatch)));
      if (rewritten === null) continue;
      out += text.slice(last, start) + rewritten;
      last = end;
      count++;
      continue;
    }
    out += text.slice(last, start) + tokenForMatch(rule.id, text.slice(start, end), onMatch);
    last = end;
    count++;
  }
  return count === 0 ? { text, count } : { text: out + text.slice(last), count };
}

function applyEntropy(
  text: string,
  spec: EntropySpec,
  isAllowed: (s: string) => boolean,
  onMatch?: RedactionContext['onMatch']
): { text: string; count: number } {
  const candidates = new RegExp(`[A-Za-z0-9+/=_.~-]{${spec.minLength},}`, 'g');
  const spans = text.includes(TOKEN_PREFIX) ? tokenSpans(text) : null;
  let out = '';
  let last = 0;
  let count = 0;
  for (const m of text.matchAll(candidates)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (spans && overlapsAny(spans, start, end)) continue;
    if (isAllowed(m[0])) continue;
    if (shannonEntropy(m[0]) < spec.threshold) continue;
    if (spec.requireKeyword) {
      let before = text.slice(Math.max(0, start - spec.window), start);
      before = before.slice(before.lastIndexOf('\n') + 1).toLowerCase();
      if (!spec.keywords.some(k => before.includes(k))) continue;
    }
    out += text.slice(last, start) + tokenForMatch(ENTROPY_RULE_ID, m[0], onMatch);
    last = end;
    count++;
  }
  return count === 0 ? { text, count } : { text: out + text.slice(last), count };
}

export function createRedactor(config: RedactionConfig): Redactor {
  const compiled = compileConfig(config);
  const isAllowed = (secret: string) => compiled.allowlist.some(re => re.test(secret));

  return {
    ruleIds: compiled.rules.map(r => r.id),
    isSecretField(name: string): boolean {
      if (!compiled.secretField || typeof name !== 'string') return false;
      const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\d+$/, '');
      return normalized.length > 0 && compiled.secretField.test(normalized);
    },
    redact(text: string, ctx?: RedactionContext): RedactionResult {
      if (typeof text !== 'string' || text.length === 0) return { text, findings: [] };
      let current = text;
      let lower: string | null = null;
      const counts = new Map<string, number>();

      for (const rule of compiled.rules) {
        if (rule.keywords) {
          lower ??= current.toLowerCase();
          if (!rule.keywords.some(k => lower!.includes(k))) continue;
        }
        const r = applyRule(current, rule, isAllowed, ctx?.onMatch);
        if (r.count > 0) {
          current = r.text;
          lower = null;
          counts.set(rule.id, (counts.get(rule.id) ?? 0) + r.count);
        }
      }

      if (compiled.entropy.enabled) {
        const r = applyEntropy(current, compiled.entropy, isAllowed, ctx?.onMatch);
        if (r.count > 0) {
          current = r.text;
          counts.set(ENTROPY_RULE_ID, r.count);
        }
      }

      return { text: current, findings: [...counts].map(([ruleId, count]) => ({ ruleId, count })) };
    },
  };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/** Aggregates findings by rule id. Never holds matched values. */
export class FindingsTally {
  private counts = new Map<string, number>();

  add(findings: RedactionFinding[]): void {
    for (const f of findings) this.counts.set(f.ruleId, (this.counts.get(f.ruleId) ?? 0) + f.count);
  }

  get total(): number {
    let n = 0;
    for (const c of this.counts.values()) n += c;
    return n;
  }

  toArray(): RedactionFinding[] {
    return [...this.counts].map(([ruleId, count]) => ({ ruleId, count }));
  }
}

/** "7 value(s) redacted (azure-storage-key: 2, jwt: 5)" */
export function formatFindings(findings: RedactionFinding[]): string {
  const total = findings.reduce((n, f) => n + f.count, 0);
  if (total === 0) return 'no values redacted';
  const detail = [...findings]
    .sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId))
    .map(f => `${f.ruleId}: ${f.count}`)
    .join(', ');
  return `${total} value(s) redacted (${detail})`;
}

// ---------------------------------------------------------------------------
// JSON / JSONL / files
// ---------------------------------------------------------------------------

/**
 * Redact a parsed JSON tree in place: string values by the text rules, values
 * by their field name (secretFields), and keys that are themselves secrets.
 */
function redactTree(
  node: unknown,
  redactor: Redactor,
  ctx: RedactionContext | undefined,
  tally: FindingsTally | undefined
): { value: unknown; changed: boolean } {
  if (typeof node === 'string') {
    const r = redactor.redact(node, ctx);
    if (r.findings.length === 0) return { value: node, changed: false };
    tally?.add(r.findings);
    return { value: r.text, changed: r.text !== node };
  }
  if (node === null || typeof node !== 'object') return { value: node, changed: false };

  let changed = false;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const r = redactTree(node[i], redactor, ctx, tally);
      if (r.changed) { node[i] = r.value; changed = true; }
    }
    return { value: node, changed };
  }
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (const key of keys) {
    const r = redactTree(obj[key], redactor, ctx, tally);
    if (r.changed) {
      setOwn(obj, key, r.value);
      changed = true;
    }
  }

  // Field-name context: the key (or a {name, value} pair's name, or a Key
  // Vault secret id) says the value is a secret even when its shape matches
  // no rule — e.g. a letters-only clientSecret field in a structured
  // MCP result. Runs after the text rules; a value they redacted only in part
  // is still replaced whole, since the field name says all of it is secret.
  const redactWhole = (key: string) => {
    const value = obj[key];
    if (!isRedactableWhole(value)) return;
    setOwn(obj, key, tokenForMatch(FIELD_RULE_ID, value, ctx?.onMatch));
    tally?.add([{ ruleId: FIELD_RULE_ID, count: 1 }]);
    changed = true;
  };
  for (const key of keys) {
    if (redactor.isSecretField(key)) redactWhole(key);
  }
  const lower = new Map(keys.map(k => [k.toLowerCase(), k]));
  const valueKey = lower.get('value');
  if (valueKey !== undefined) {
    const nameKey = lower.get('name') ?? lower.get('key');
    const nameValue = nameKey !== undefined ? obj[nameKey] : undefined;
    const id = lower.has('id') ? obj[lower.get('id')!] : undefined;
    if (
      (typeof nameValue === 'string' && redactor.isSecretField(nameValue)) ||
      (typeof id === 'string' && KEY_VAULT_SECRET_ID.test(id))
    ) {
      redactWhole(valueKey);
    }
  }

  // Keys themselves: a secret used as a key (a token-keyed cache) is renamed
  // to its token. Harness keys never match a rule, so structure is unchanged.
  let renamed: Array<[string, unknown]> | null = null;
  for (let i = 0; i < keys.length; i++) {
    const r = redactor.redact(keys[i], ctx);
    if (r.findings.length === 0) continue;
    tally?.add(r.findings);
    renamed ??= keys.map(k => [k, obj[k]]);
    renamed[i][0] = r.text;
  }
  if (renamed) {
    const rebuilt: Record<string, unknown> = {};
    for (const [key, value] of renamed) {
      let unique = key;
      for (let n = 2; Object.prototype.hasOwnProperty.call(rebuilt, unique); n++) unique = `${key}#${n}`;
      setOwn(rebuilt, unique, value);
    }
    return { value: rebuilt, changed: true };
  }
  return { value: obj, changed };
}

function setOwn(obj: Record<string, unknown>, key: string, value: unknown): void {
  // defineProperty so a "__proto__" key from JSON.parse stays an own property.
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

// A value that is only tokens is already redacted; anything else in a secret
// field, even alongside a token, is replaced whole.
const ONLY_TOKENS = /^\s*(?:\[REDACTED:[a-z0-9][a-z0-9-]*\]\s*)+$/;

function isRedactableWhole(value: unknown): value is string {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    !ONLY_TOKENS.test(value) &&
    !PLACEHOLDER_VALUE.test(value.trim());
}

/**
 * Redact one JSONL line. Valid JSON stays valid (string values are redacted
 * and the line is re-serialized only if something changed); a line that isn't
 * JSON (e.g. a torn last line mid-write) is redacted as raw text. A trailing
 * `\r` is preserved.
 */
export function redactJsonlLine(
  line: string,
  redactor: Redactor,
  ctx?: RedactionContext,
  tally?: FindingsTally
): string {
  const cr = line.endsWith('\r') ? '\r' : '';
  const body = cr ? line.slice(0, -1) : line;
  if (body.trim().length === 0) return line;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    const r = redactor.redact(body, ctx);
    if (r.findings.length === 0) return line;
    tally?.add(r.findings);
    return r.text + cr;
  }

  const r = redactTree(parsed, redactor, ctx, tally);
  return r.changed ? JSON.stringify(r.value) + cr : line;
}

const COPY_CHUNK_BYTES = 1 << 20; // 1 MiB

/**
 * Stream `src` to `dest`, redacting line by line. Writes `dest` directly;
 * callers that need atomicity write to a temp path and rename. Line count and
 * trailing-newline shape match the source exactly, so archive line numbers
 * (exchanges.line_start/line_end, MCP read ranges) stay valid.
 */
export function copyFileRedacted(
  src: string,
  dest: string,
  redactor: Redactor,
  ctx?: RedactionContext,
  tally?: FindingsTally
): void {
  const fdIn = fs.openSync(src, 'r');
  let fdOut: number | undefined;
  try {
    // Create with the source's mode, as copyFileSync would, so a 0600
    // transcript doesn't become world-readable in the archive.
    fdOut = fs.openSync(dest, 'w', fs.fstatSync(fdIn).mode & 0o777);
    const buf = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let bytesRead: number;
    while ((bytesRead = fs.readSync(fdIn, buf, 0, buf.length, null)) > 0) {
      let scanFrom = pending.length;
      pending += decoder.write(buf.subarray(0, bytesRead));
      const out: string[] = [];
      let start = 0;
      let nl: number;
      while ((nl = pending.indexOf('\n', scanFrom)) !== -1) {
        out.push(redactJsonlLine(pending.slice(start, nl), redactor, ctx, tally), '\n');
        start = nl + 1;
        scanFrom = start;
      }
      if (out.length > 0) fs.writeSync(fdOut, out.join(''));
      pending = pending.slice(start);
    }
    pending += decoder.end();
    if (pending.length > 0) fs.writeSync(fdOut, redactJsonlLine(pending, redactor, ctx, tally));
  } finally {
    fs.closeSync(fdIn);
    if (fdOut !== undefined) fs.closeSync(fdOut);
  }
}
