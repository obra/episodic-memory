/**
 * Get the Claude Code configuration directory.
 * Supports CLAUDE_CONFIG_DIR for multiple profiles.
 * Falls back to ~/.claude when not set.
 */
export declare function getClaudeDir(): string;
/**
 * Get the Codex configuration directory.
 * Supports CODEX_HOME for alternate profiles.
 * Falls back to ~/.codex when not set.
 */
export declare function getCodexDir(): string;
/**
 * Get the opencode data directory.
 * opencode stores its SQLite database under XDG data by default.
 */
export declare function getOpencodeDataDir(): string;
/**
 * Get the opencode SQLite database path.
 */
export declare function getOpencodeDbPath(): string;
/**
 * Get the generated opencode transcript directory used as a sync source.
 */
export declare function getOpencodeTranscriptDir(): string;
export type ConversationSourceHarness = 'claude' | 'codex' | 'opencode';
/**
 * Get all directories where supported harnesses store conversation files.
 * Checks Claude Code legacy (projects/) and current (transcripts/) locations,
 * Codex sessions, and generated opencode transcripts.
 * Returns only directories that exist.
 */
export declare function getConversationSourceDirs(only?: ConversationSourceHarness[]): string[];
/**
 * Recursively find all .jsonl files under a directory.
 * Returns paths relative to the given directory.
 *
 * `excludedDirNames` skips any subdirectory whose name matches an entry in
 * the set, at any depth. Top-level project skipping at the caller is the
 * usual case; this parameter handles nested directories like `subagents/`
 * inside session UUIDs (#80).
 */
export declare function findJsonlFiles(dir: string, excludedDirNames?: ReadonlySet<string>): string[];
/**
 * Get the personal superpowers directory
 *
 * Precedence:
 * 1. EPISODIC_MEMORY_CONFIG_DIR env var (if set, for testing)
 * 2. PERSONAL_SUPERPOWERS_DIR env var (if set)
 * 3. XDG_CONFIG_HOME/superpowers (if XDG_CONFIG_HOME is set)
 * 4. ~/.config/superpowers (default)
 */
export declare function getSuperpowersDir(): string;
/**
 * Get conversation archive directory
 */
export declare function getArchiveDir(): string;
/**
 * Get conversation index directory
 */
export declare function getIndexDir(): string;
/**
 * Get database path
 */
export declare function getDbPath(): string;
/**
 * Get exclude config path
 */
export declare function getExcludeConfigPath(): string;
/**
 * Get list of projects to exclude from indexing
 * Configurable via env var or config file
 */
export declare function getExcludedProjects(): string[];
