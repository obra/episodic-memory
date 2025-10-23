import os from 'os';
import path from 'path';
/**
 * Get the personal superpowers directory
 *
 * Precedence:
 * 1. EPISODIC_MEMORY_CONFIG_DIR env var (if set, for testing)
 * 2. PERSONAL_SUPERPOWERS_DIR env var (if set)
 * 3. XDG_CONFIG_HOME/superpowers (if XDG_CONFIG_HOME is set)
 * 4. ~/.config/superpowers (default)
 */
export function getSuperpowersDir() {
    if (process.env.EPISODIC_MEMORY_CONFIG_DIR) {
        return process.env.EPISODIC_MEMORY_CONFIG_DIR;
    }
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
export function getArchiveDir() {
    // Allow test override
    if (process.env.TEST_ARCHIVE_DIR) {
        return process.env.TEST_ARCHIVE_DIR;
    }
    return path.join(getSuperpowersDir(), 'conversation-archive');
}
/**
 * Get conversation index directory
 */
export function getIndexDir() {
    return path.join(getSuperpowersDir(), 'conversation-index');
}
/**
 * Get database path
 */
export function getDbPath() {
    // Allow test override with direct DB path
    if (process.env.EPISODIC_MEMORY_DB_PATH || process.env.TEST_DB_PATH) {
        return process.env.EPISODIC_MEMORY_DB_PATH || process.env.TEST_DB_PATH;
    }
    return path.join(getIndexDir(), 'db.sqlite');
}
/**
 * Get exclude config path
 */
export function getExcludeConfigPath() {
    return path.join(getIndexDir(), 'exclude.txt');
}
