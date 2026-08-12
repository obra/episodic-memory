import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Runtime-required packages externalized from the MCP server bundle (see the
 * `bundle` script in package.json). The bundle inline-imports these at runtime
 * via Node's resolver, so a partial node_modules extraction — directory exists
 * but the package is missing its package.json and lib/ — surfaces as a
 * confusing `ERR_MODULE_NOT_FOUND` *after* the wrapper has already declared
 * dependencies healthy and launched the server (#95 Bug 1).
 *
 * Excludes optional / OS-specific externals (sharp, fsevents) — missing those
 * is not necessarily fatal.
 */
export const REQUIRED_PACKAGES = [
  '@anthropic-ai/claude-agent-sdk',
  '@huggingface/transformers',
  'better-sqlite3',
  'onnxruntime-node',
  'proper-lockfile',
  'sqlite-vec',
];

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * True when `pkg` is installed somewhere Node's resolver will find it from the
 * plugin root: either hoisted to the top of `node_modules` (the common case)
 * or nested one level down under the dependent that pinned it.
 *
 * npm nests instead of hoisting whenever a version conflict blocks the flat
 * layout — the same mechanism behind #105 and #135. episodic-memory hits it
 * with onnxruntime-node, which @huggingface/transformers pins to its own range
 * and which therefore lands at
 * `node_modules/@huggingface/transformers/node_modules/onnxruntime-node`.
 *
 * A top-level-only probe calls that "missing" on every single launch, so
 * mcp-server-wrapper reruns `npm install` every time the server starts (~20s).
 * That routinely exceeds the client's 30s MCP connect timeout, so the server
 * the user is waiting on never becomes available.
 *
 * The reinstall cannot fix what the probe detects: npm already considers the
 * tree complete and leaves the package nested, so every launch pays the cost
 * and nothing changes. Worse, when the connect timeout kills the wrapper
 * mid-install it can interrupt the postinstall rebuild, which is how a broken
 * native binding (#100) survives across restarts that were supposed to repair
 * it.
 *
 * The search stays inside the plugin's own node_modules on purpose: resolving
 * via `createRequire` would also walk parent directories and Node's global
 * folders, which could report a package as present that the plugin cannot
 * actually load.
 */
function isResolvable(nodeModules, pkg) {
  if (existsSync(join(nodeModules, pkg, 'package.json'))) {
    return true;
  }

  for (const entry of safeReaddir(nodeModules)) {
    if (!entry.isDirectory()) continue;
    const entryPath = join(nodeModules, entry.name);

    // Scope directories (@foo) hold packages one level deeper.
    const dependents = entry.name.startsWith('@')
      ? safeReaddir(entryPath)
          .filter(d => d.isDirectory())
          .map(d => join(entryPath, d.name))
      : [entryPath];

    for (const dependent of dependents) {
      if (existsSync(join(dependent, 'node_modules', pkg, 'package.json'))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Return the list of required packages that are not installed under
 * `<pluginRoot>/node_modules`. An empty array means the install looks complete;
 * a non-empty array is the diagnostic to print before re-running `npm install`.
 *
 * Probing each package's package.json — not just the directory — catches
 * partial extractions where the folder exists but the manifest hasn't been
 * written yet (the failure mode reported for episodic-memory@1.4.1 on Windows
 * 11 in #95).
 */
export function findMissingDeps(pluginRoot) {
  const nodeModules = join(pluginRoot, 'node_modules');
  if (!existsSync(nodeModules)) {
    return REQUIRED_PACKAGES.slice();
  }
  return REQUIRED_PACKAGES.filter(pkg => !isResolvable(nodeModules, pkg));
}
