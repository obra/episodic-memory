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
export declare const REDACTION_ENABLED_BY_DEFAULT = true;
export declare const REDACTION_RULES_FILENAME = "redaction-rules.json";
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
export declare class RedactionConfigError extends Error {
    constructor(message: string);
}
/**
 * EPISODIC_MEMORY_REDACTION         on (fork default) | off
 * EPISODIC_MEMORY_REDACTION_RULES   path to a custom rules file
 * EPISODIC_MEMORY_REDACTION_STRICT  1 (default) | 0; strict fails closed on a rules-load error
 */
export declare function getRedactionSettings(env?: NodeJS.ProcessEnv): RedactionSettings;
/**
 * Merge a rules file with the bundled defaults and validate the result.
 * Throws RedactionConfigError on any invalid rule.
 */
export declare function loadRedactionConfig(file: RedactionRulesFile): RedactionConfig;
/**
 * Load the active redactor from the environment.
 *
 * Returns null when redaction is off. When the rules can't be loaded: strict
 * mode (the default) throws RedactionConfigError so callers fail closed;
 * non-strict mode warns and returns null, so text passes through unredacted.
 */
export declare function loadRedactor(env?: NodeJS.ProcessEnv, warn?: (message: string) => void): Redactor | null;
/**
 * Describe a value without revealing it: length, character classes and
 * Shannon entropy (bits per char), e.g. "len=40 aA9- H=4.9". Lets someone
 * reviewing hits tell a random key from a word or a placeholder.
 */
export declare function describeShape(value: string): string;
/** Each `[REDACTED:<ruleId>]` token in `text`, left to right. */
export declare function findRedactionTokens(text: string): Array<{
    ruleId: string;
    start: number;
    end: number;
}>;
export declare function createRedactor(config: RedactionConfig): Redactor;
/** Aggregates findings by rule id. Never holds matched values. */
export declare class FindingsTally {
    private counts;
    add(findings: RedactionFinding[]): void;
    get total(): number;
    toArray(): RedactionFinding[];
}
/** "7 value(s) redacted (azure-storage-key: 2, jwt: 5)" */
export declare function formatFindings(findings: RedactionFinding[]): string;
/**
 * Redact one JSONL line. Valid JSON stays valid (string values are redacted
 * and the line is re-serialized only if something changed); a line that isn't
 * JSON (e.g. a torn last line mid-write) is redacted as raw text. A trailing
 * `\r` is preserved.
 */
export declare function redactJsonlLine(line: string, redactor: Redactor, ctx?: RedactionContext, tally?: FindingsTally): string;
/**
 * Stream `src` to `dest`, redacting line by line. Writes `dest` directly;
 * callers that need atomicity write to a temp path and rename. Line count and
 * trailing-newline shape match the source exactly, so archive line numbers
 * (exchanges.line_start/line_end, MCP read ranges) stay valid.
 */
export declare function copyFileRedacted(src: string, dest: string, redactor: Redactor, ctx?: RedactionContext, tally?: FindingsTally): void;
