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
 * Get all directories where Claude Code stores conversation files.
 * Checks both legacy (projects/) and current (transcripts/) locations.
 * Returns only directories that exist.
 */
export function getConversationSourceDirs(): string[] {
  const testDir = process.env.TEST_PROJECTS_DIR;
  if (testDir) return [testDir];

  const claudeDir = getClaudeDir();
  return [
    path.join(claudeDir, 'projects'),
    path.join(claudeDir, 'transcripts'),
  ].filter(d => fs.existsSync(d));
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
