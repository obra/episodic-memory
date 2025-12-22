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
