import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Isolate every test run from the developer's real ~/.config/superpowers.
 * Without this, getSuperpowersDir()'s ensureDir side effect creates real dirs
 * (and sometimes a real db.sqlite) when EPISODIC_MEMORY_CONFIG_DIR is unset.
 * See https://github.com/obra/episodic-memory/issues/119
 */
const isolatedRoot = mkdtempSync(join(tmpdir(), 'episodic-memory-vitest-'));

process.env.EPISODIC_MEMORY_CONFIG_DIR = join(isolatedRoot, 'superpowers');
process.env.CLAUDE_CONFIG_DIR = join(isolatedRoot, 'claude');
process.env.CODEX_HOME = join(isolatedRoot, 'codex');
