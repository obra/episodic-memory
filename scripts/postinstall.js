#!/usr/bin/env node
/**
 * Cross-platform postinstall: get better-sqlite3's native binding into a state
 * where it actually loads, and refuse to report success until it does.
 *
 * Replaces the unix-only shell idiom that lived in package.json:
 *
 *   "postinstall": "npm rebuild better-sqlite3 2>/dev/null || true"
 *
 * On Windows cmd.exe that line fails — `2>/dev/null` isn't valid redirection
 * and `|| true` doesn't behave the same — which makes `npm install` exit
 * non-zero even when every dependency installed correctly (#95).
 *
 * Why the exit status of `npm rebuild` cannot be trusted (#100)
 * ------------------------------------------------------------
 * `npm rebuild better-sqlite3` does not reliably run better-sqlite3's own
 * install script (`prebuild-install || node-gyp rebuild --release`). On the npm
 * shipped with recent Node it prints "rebuilt dependencies successfully",
 * exits 0, and builds nothing. Separately, better-sqlite3 publishes prebuilds
 * only for the Node versions in its `engines` range, so on a newer host Node
 * `prebuild-install` can leave a binary compiled for an older ABI in place.
 *
 * Both failures look identical from the outside: a clean install, and a plugin
 * whose search silently returns nothing because the MCP server dies loading the
 * binding — in a log nobody reads.
 *
 * So this script does three things `status !== 0` cannot:
 *
 *   1. Verifies by INSTANTIATING a database, not by requiring the module.
 *      `require('better-sqlite3')` succeeds with no binding at all, because the
 *      addon is loaded lazily inside `new Database()` (#100).
 *   2. Verifies in a CHILD process. A native addon cannot be un-loaded, so a
 *      failed load poisons the module cache and an in-process re-check after a
 *      repair attempt would be meaningless.
 *   3. On failure, falls back to better-sqlite3's real build path
 *      (`npm run build-release` = `node-gyp rebuild --release`) and re-verifies,
 *      rather than printing a recovery hint naming the command that just failed.
 *
 * Exit code reflects the binding, not the tooling: a noisy `npm rebuild` whose
 * binding nevertheless loads is NOT fatal (that is the #95 false alarm), and a
 * clean `npm rebuild` that leaves an unloadable binding IS.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BETTER_SQLITE3_DIR = join(PLUGIN_ROOT, 'node_modules', 'better-sqlite3');

const isWindows = process.platform === 'win32';
const npmBin = isWindows ? 'npm.cmd' : 'npm';

function npm(args, cwd) {
  return spawnSync(npmBin, args, {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: isWindows,
  });
}

/**
 * Load the native stack the way the MCP server will — instantiate a database,
 * then load sqlite-vec into it — in a throwaway child process.
 *
 * Returns null on success, or { stderr } describing the failure.
 *
 * sqlite-vec is only fatal when it is actually installed; during some install
 * orderings it is not resolvable yet, which is a dependency problem the
 * wrapper's own probe handles, not a native-binding problem.
 */
function verifyNativeStack() {
  const pkgJson = JSON.stringify(join(PLUGIN_ROOT, 'package.json'));
  const script = `
    const { createRequire } = require('module');
    const req = createRequire(${pkgJson});
    const Database = req('better-sqlite3');
    const db = new Database(':memory:');
    let vec = null;
    try { vec = req('sqlite-vec'); } catch (e) { vec = null; }
    if (vec) { vec.load(db); db.prepare('select vec_version()').get(); }
    db.close();
  `;

  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: PLUGIN_ROOT,
    encoding: 'utf-8',
  });

  if (result.status === 0) return null;
  return { stderr: (result.stderr || '').trim() || `child exited ${result.status}` };
}

// Attempt 1: the cheap path that works on most hosts.
const rebuild = npm(['rebuild', 'better-sqlite3'], PLUGIN_ROOT);
let failure = verifyNativeStack();

// Attempt 2: better-sqlite3's real build path. `npm rebuild` frequently does
// not run it, and it is the step that actually compiles for this Node's ABI.
let fallback = null;
if (failure && existsSync(BETTER_SQLITE3_DIR)) {
  console.error(
    'episodic-memory: better-sqlite3 binding did not load after `npm rebuild`; ' +
    'compiling from source with `npm run build-release`...'
  );
  fallback = npm(['run', 'build-release'], BETTER_SQLITE3_DIR);
  failure = verifyNativeStack();
  if (!failure) {
    console.error('episodic-memory: source build succeeded — native binding loads.');
  }
}

if (!failure) {
  if (rebuild.status !== 0 && !fallback) {
    // Rebuild complained but the binding loads — the #95 false-alarm case.
    console.error(
      `episodic-memory: 'npm rebuild better-sqlite3' exited ${rebuild.status}, ` +
      'but the native binding loads correctly for this Node ' +
      `(${process.version}, NODE_MODULE_VERSION ${process.versions.modules}). ` +
      'Continuing.'
    );
  }
  process.exit(0);
}

const compiledFor = /NODE_MODULE_VERSION (\d+)/.exec(failure.stderr);
const noBindings = /Could not locate the bindings file/.test(failure.stderr);

console.error('');
console.error('='.repeat(72));
console.error('episodic-memory: NATIVE BINDING IS BROKEN — conversation search will not work.');
console.error('='.repeat(72));
console.error(`  this Node        : ${process.version} (NODE_MODULE_VERSION ${process.versions.modules})`);
if (compiledFor) {
  console.error(`  binary built for : NODE_MODULE_VERSION ${compiledFor[1]}  <-- ABI MISMATCH`);
}
if (noBindings) {
  console.error('  binary           : missing entirely (nothing was compiled)');
}
console.error(`  npm rebuild exit : ${rebuild.status}`);
if (fallback) {
  console.error(`  source build exit: ${fallback.status}`);
}
console.error('');
console.error('  underlying error:');
for (const line of failure.stderr.split('\n').slice(0, 12)) {
  console.error(`    ${line}`);
}
console.error('');
console.error('  A source build needs a working toolchain: Xcode Command Line Tools on');
console.error('  macOS, build-essential + python3 on Linux, VS Build Tools on Windows.');
console.error('');
console.error('  Recover with:');
console.error(`    cd "${BETTER_SQLITE3_DIR}" && npm run build-release`);
console.error('');
console.error('  Failing the install deliberately: passing silently here is what lets');
console.error('  search disappear without anyone noticing.');
console.error('='.repeat(72));
console.error('');

process.exit(1);
