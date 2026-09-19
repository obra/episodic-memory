#!/usr/bin/env node
/**
 * Cross-platform postinstall: verify that better-sqlite3 and sqlite-vec work
 * together, and refuse to report success until they do.
 *
 * Replaces the unix-only shell idiom that lived in package.json:
 *
 *   "postinstall": "npm rebuild better-sqlite3 2>/dev/null || true"
 *
 * On Windows cmd.exe that line fails — `2>/dev/null` isn't valid redirection
 * and `|| true` doesn't behave the same — which makes `npm install` exit
 * non-zero even when every dependency installed correctly (#95).
 *
 * Why this no longer rebuilds better-sqlite3 (#100)
 * -------------------------------------------------
 * better-sqlite3 13.x ships N-API platform binaries in the npm package. They
 * are not tied to a single Node module ABI and do not need an install script.
 * Rebuilding the old 12.x addon was both unreliable and unsafe: a rebuild with
 * Node 24.19-24.21 headers could produce a binding that loaded successfully but
 * later aborted during statement garbage collection.
 *
 * A broken or partial install still looks like a clean install from the
 * outside, while the MCP server dies loading the binding in a log nobody reads.
 *
 * So this script verifies behavior rather than trusting package-manager status:
 *
 *   1. Verifies by INSTANTIATING a database, not by requiring the module.
 *      `require('better-sqlite3')` succeeds with no binding at all, because the
 *      addon is loaded lazily inside `new Database()` (#100).
 *   2. Loads sqlite-vec and performs a real vec0 insert plus nearest-neighbor
 *      query, rather than stopping at `vec_version()`.
 *   3. Verifies in a CHILD process so native failures cannot poison the
 *      postinstall process.
 *
 * There is deliberately no automatic source-build fallback. If the bundled
 * N-API binary cannot run, failing closed preserves the original evidence and
 * avoids replacing it with a runtime-specific local build.
 */
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Load the native stack the way the MCP server will: instantiate a database,
 * load sqlite-vec, write a vector, and run a nearest-neighbor query.
 *
 * Returns the installed better-sqlite3 version on success, or a failure with
 * stderr on error.
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
    const version = req('better-sqlite3/package.json').version;
    const Database = req('better-sqlite3');
    const db = new Database(':memory:');
    let vec = null;
    try { vec = req('sqlite-vec'); } catch (e) { vec = null; }
    if (vec) {
      vec.load(db);
      db.exec('CREATE VIRTUAL TABLE native_probe USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[2])');
      const embedding = Buffer.from(new Float32Array([1, 0]).buffer);
      db.prepare('INSERT INTO native_probe (id, embedding) VALUES (?, ?)').run('probe', embedding);
      const row = db.prepare(
        'SELECT id FROM native_probe WHERE embedding MATCH ? AND k = 1'
      ).get(embedding);
      if (!row || row.id !== 'probe') throw new Error('sqlite-vec query returned the wrong row');
    }
    db.close();
    process.stdout.write(version);
  `;

  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: PLUGIN_ROOT,
    encoding: 'utf-8',
  });

  if (result.status === 0) {
    return { version: (result.stdout || '').trim() || 'unknown', failure: null };
  }
  return {
    version: null,
    failure: (result.stderr || '').trim() || `child exited ${result.status}`,
  };
}

const verification = verifyNativeStack();
const failure = verification.failure;

if (!failure) {
  console.error(
    `episodic-memory: native stack verified (better-sqlite3 ${verification.version}, ` +
    `${process.version}, N-API ${process.versions.napi}).`
  );
  process.exit(0);
}

const compiledFor = /NODE_MODULE_VERSION (\d+)/.exec(failure);
const noBindings = /Could not locate the bindings file/.test(failure);

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
console.error('');
console.error('  underlying error:');
for (const line of failure.split('\n').slice(0, 12)) {
  console.error(`    ${line}`);
}
console.error('');
console.error('  better-sqlite3 13.x includes N-API platform binaries; do not compile');
console.error('  the old 12.x addon as a fallback. Reinstall episodic-memory with the');
console.error('  same package manifest, then rerun this check.');
console.error('');
console.error('  Failing the install deliberately: passing silently here is what lets');
console.error('  search disappear without anyone noticing.');
console.error('='.repeat(72));
console.error('');

process.exit(1);
