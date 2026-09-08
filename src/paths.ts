import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Ensure a directory exists, creating it if necessary
 */
function ensureDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the Claude Code configuration directory.
 * Supports CLAUDE_CONFIG_DIR for multiple profiles.
 * Falls back to ~/.claude when not set.
 */
export function getClaudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/**
 * Get the Codex configuration directory.
 * Supports CODEX_HOME for alternate profiles.
 * Falls back to ~/.codex when not set.
 */
export function getCodexDir(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/**
 * Get the Cursor configuration directory.
 * Supports CURSOR_HOME for alternate profiles.
 * Falls back to ~/.cursor when not set.
 */
export function getCursorDir(): string {
  return process.env.CURSOR_HOME || path.join(os.homedir(), '.cursor');
}

/**
 * Get the staging directory where `import-cursor-history` exports legacy
 * Cursor conversations (extracted from state.vscdb) as JSONL. Scanned as a
 * conversation source so sync picks the exports up like any other harness.
 */
export function getCursorLegacyExportDir(): string {
  return path.join(getSuperpowersDir(), 'cursor-legacy-export');
}

/**
 * Get the Oh My Pi (OMP) configuration directory.
 * Supports OMP_HOME for alternate profiles.
 * Falls back to ~/.omp when not set.
 */
export function getOmpDir(): string {
  return process.env.OMP_HOME || path.join(os.homedir(), '.omp');
}

/**
 * Get the opencode data directory.
 * opencode stores its SQLite database under XDG data by default.
 */
export function getOpencodeDataDir(): string {
  if (process.env.EPISODIC_MEMORY_OPENCODE_DATA_DIR) {
    return process.env.EPISODIC_MEMORY_OPENCODE_DATA_DIR;
  }
  if (process.env.OPENCODE_DATA_DIR) {
    return process.env.OPENCODE_DATA_DIR;
  }

  const xdgDataHome = process.env.XDG_DATA_HOME;
  return path.join(xdgDataHome || path.join(os.homedir(), '.local', 'share'), 'opencode');
}

/**
 * Get the opencode SQLite database path.
 */
export function getOpencodeDbPath(): string {
  return process.env.EPISODIC_MEMORY_OPENCODE_DB_PATH || path.join(getOpencodeDataDir(), 'opencode.db');
}

/**
 * Get the generated opencode transcript directory used as a sync source.
 */
export function getOpencodeTranscriptDir(): string {
  return process.env.EPISODIC_MEMORY_OPENCODE_TRANSCRIPT_DIR ||
    path.join(getSuperpowersDir(), 'opencode-transcripts');
}

export type ConversationSourceHarness = 'claude' | 'codex' | 'cursor' | 'opencode' | 'omp';

/**
 * Get all directories where supported harnesses store conversation files.
 * Checks Claude Code legacy (projects/) and current (transcripts/) locations,
 * Codex sessions, Cursor agent transcripts (live and legacy exports), and
 * generated opencode transcripts.
 * Returns only directories that exist.
 */
export function getConversationSourceDirs(only?: ConversationSourceHarness[]): string[] {
  const testDir = process.env.TEST_PROJECTS_DIR;
  if (testDir) return [testDir];

  const claudeDir = getClaudeDir();
  const codexDir = getCodexDir();
  const cursorDir = getCursorDir();
  const allowed = only ? new Set(only) : undefined;
  const candidates: Array<{ harness: ConversationSourceHarness; dir: string }> = [
    { harness: 'claude', dir: path.join(claudeDir, 'projects') },
    { harness: 'claude', dir: path.join(claudeDir, 'transcripts') },
    { harness: 'codex', dir: path.join(codexDir, 'sessions') },
    { harness: 'cursor', dir: path.join(cursorDir, 'projects') },
    { harness: 'cursor', dir: getCursorLegacyExportDir() },
    { harness: 'opencode', dir: getOpencodeTranscriptDir() },
    { harness: 'omp', dir: path.join(getOmpDir(), 'agent', 'sessions') },
  ];
  return candidates
    .filter(candidate => !allowed || allowed.has(candidate.harness))
    .map(candidate => candidate.dir)
    .filter(d => fs.existsSync(d));
}

/**
 * Recursively find all .jsonl files under a directory.
 * Returns paths relative to the given directory.
 *
 * `excludedDirNames` skips any subdirectory whose name matches an entry in
 * the set, at any depth. Top-level project skipping at the caller is the
 * usual case; this parameter handles nested directories like `subagents/`
 * inside session UUIDs (#80).
 */
export function findJsonlFiles(dir: string, excludedDirNames?: ReadonlySet<string>): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(entry.name);
      } else if (entry.isDirectory()) {
        if (excludedDirNames?.has(entry.name)) continue;
        const subDir = path.join(dir, entry.name);
        for (const f of findJsonlFiles(subDir, excludedDirNames)) {
          results.push(path.join(entry.name, f));
        }
      }
    }
  } catch {
    // Directory might not be readable
  }
  return results;
}

/**
 * statSync that follows symlinks but returns null instead of throwing when
 * the entry cannot be stat'ed — a dangling symlink (e.g. left behind by a
 * storage migration), or an entry deleted between readdir and stat.
 * Callers treat null as "skip this entry".
 */
export function statIfExists(target: string): fs.Stats | null {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

/**
 * Get the personal superpowers directory
 *
 * Precedence:
 * 1. EPISODIC_MEMORY_CONFIG_DIR env var (if set, for testing)
 * 2. PERSONAL_SUPERPOWERS_DIR env var (if set)
 * 3. XDG_CONFIG_HOME/superpowers (if XDG_CONFIG_HOME is set)
 * 4. ~/.config/superpowers (default)
 */
export function getSuperpowersDir(): string {
  let dir: string;

  if (process.env.EPISODIC_MEMORY_CONFIG_DIR) {
    dir = process.env.EPISODIC_MEMORY_CONFIG_DIR;
  } else if (process.env.PERSONAL_SUPERPOWERS_DIR) {
    dir = process.env.PERSONAL_SUPERPOWERS_DIR;
  } else {
    const xdgConfigHome = process.env.XDG_CONFIG_HOME;
    if (xdgConfigHome) {
      dir = path.join(xdgConfigHome, 'superpowers');
    } else {
      dir = path.join(os.homedir(), '.config', 'superpowers');
    }
  }

  return ensureDir(dir);
}

/**
 * Get conversation archive directory
 */
export function getArchiveDir(): string {
  // Allow test override
  if (process.env.TEST_ARCHIVE_DIR) {
    return ensureDir(process.env.TEST_ARCHIVE_DIR);
  }

  return ensureDir(path.join(getSuperpowersDir(), 'conversation-archive'));
}

/**
 * Get conversation index directory
 */
export function getIndexDir(): string {
  return ensureDir(path.join(getSuperpowersDir(), 'conversation-index'));
}

/**
 * Get database path
 */
export function getDbPath(): string {
  // Allow test override with direct DB path
  if (process.env.EPISODIC_MEMORY_DB_PATH || process.env.TEST_DB_PATH) {
    return process.env.EPISODIC_MEMORY_DB_PATH || process.env.TEST_DB_PATH!;
  }

  return path.join(getIndexDir(), 'db.sqlite');
}

/**
 * Get exclude config path
 */
export function getExcludeConfigPath(): string {
  return path.join(getIndexDir(), 'exclude.txt');
}

/**
 * Get list of projects to exclude from indexing
 * Configurable via env var or config file
 */
export function getExcludedProjects(): string[] {
  // Check env variable first
  if (process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS) {
    return process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS.split(',').map(p => p.trim());
  }

  // Check for config file
  const configPath = getExcludeConfigPath();
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    return content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  }

  // Default: no exclusions
  return [];
}
