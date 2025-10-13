import os from 'os';
import path from 'path';

/**
 * Get the personal superpowers directory
 *
 * Precedence:
 * 1. PERSONAL_SUPERPOWERS_DIR env var (if set)
 * 2. XDG_CONFIG_HOME/superpowers (if XDG_CONFIG_HOME is set)
 * 3. ~/.config/superpowers (default)
 */
export function getSuperpowersDir(): string {
  if (process.env.PERSONAL_SUPERPOWERS_DIR) {
    return process.env.PERSONAL_SUPERPOWERS_DIR;
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'superpowers');
  }

  return path.join(os.homedir(), '.config', 'superpowers');
}

/**
 * Get conversation archive directory
 */
export function getArchiveDir(): string {
  // Allow test override
  if (process.env.TEST_ARCHIVE_DIR) {
    return process.env.TEST_ARCHIVE_DIR;
  }

  return path.join(getSuperpowersDir(), 'conversation-archive');
}

/**
 * Get conversation index directory
 */
export function getIndexDir(): string {
  return path.join(getSuperpowersDir(), 'conversation-index');
}

/**
 * Get database path
 */
export function getDbPath(): string {
  return path.join(getIndexDir(), 'db.sqlite');
}

/**
 * Get exclude config path
 */
export function getExcludeConfigPath(): string {
  return path.join(getIndexDir(), 'exclude.txt');
}
