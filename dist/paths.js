import os from 'os';
import path from 'path';
import fs from 'fs';
/**
 * Ensure a directory exists, creating it if necessary
 * @throws {Error} If directory creation fails
 */
function ensureDir(dir) {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to create directory: ${dir}`);
        console.error(`Error: ${errorMessage}`);
        throw new Error(`Failed to create directory '${dir}': ${errorMessage}`);
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
export function getSuperpowersDir() {
    let dir;
    if (process.env.EPISODIC_MEMORY_CONFIG_DIR) {
        dir = process.env.EPISODIC_MEMORY_CONFIG_DIR;
    }
    else if (process.env.PERSONAL_SUPERPOWERS_DIR) {
        dir = process.env.PERSONAL_SUPERPOWERS_DIR;
    }
    else {
        const xdgConfigHome = process.env.XDG_CONFIG_HOME;
        if (xdgConfigHome) {
            dir = path.join(xdgConfigHome, 'superpowers');
        }
        else {
            dir = path.join(os.homedir(), '.config', 'superpowers');
        }
    }
    ensureDir(dir);
    return dir;
}
/**
 * Get conversation archive directory
 */
export function getArchiveDir() {
    let dir;
    // Allow test override
    if (process.env.TEST_ARCHIVE_DIR) {
        dir = process.env.TEST_ARCHIVE_DIR;
    }
    else {
        dir = path.join(getSuperpowersDir(), 'conversation-archive');
    }
    ensureDir(dir);
    return dir;
}
/**
 * Get conversation index directory
 */
export function getIndexDir() {
    const dir = path.join(getSuperpowersDir(), 'conversation-index');
    ensureDir(dir);
    return dir;
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
/**
 * Get the Claude projects directory (where conversations are stored)
 */
export function getProjectsDir() {
    const dir = process.env.TEST_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
    ensureDir(dir);
    return dir;
}
