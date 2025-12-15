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
