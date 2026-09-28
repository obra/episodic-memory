// Intercepts the real ESM CLI's child_process.spawn before importing it.
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const { pathToFileURL } = require('node:url');
const { dirname, join } = require('node:path');
const { tmpdir } = require('node:os');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');

const target = process.argv[2];
const mode = process.argv[3];
if (!target || !['command', 'mcp'].includes(mode)) process.exit(2);
const sourceRoot = dirname(dirname(target));
const pluginRoot = mkdtempSync(join(tmpdir(), 'episodic-hidden-spawn-'));
process.on('exit', () => rmSync(pluginRoot, { recursive: true, force: true }));
for (const pkg of [
  '@anthropic-ai/claude-agent-sdk', '@huggingface/transformers',
  'better-sqlite3', 'onnxruntime-node', 'proper-lockfile', 'sqlite-vec',
]) {
  const packageDir = join(pluginRoot, 'node_modules', pkg);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), '{}');
}
mkdirSync(join(pluginRoot, 'dist'), { recursive: true });
writeFileSync(join(pluginRoot, 'dist/mcp-server.js'), '');
process.env.CLAUDE_PLUGIN_ROOT = pluginRoot;
process.argv = [process.execPath, target, ...(mode === 'command' ? ['show', '--help'] : [])];
childProcess.spawn = (command, args, options) => {
  console.log('SPAWN_OPTIONS=' + JSON.stringify({ command, args, options }));
  const child = new EventEmitter();
  child.kill = () => true;
  process.nextTick(() => child.emit('exit', 0, null));
  return child;
};
syncBuiltinESMExports();
(async () => {
  if (mode === 'mcp') {
    const { findMissingDeps } = await import(pathToFileURL(join(sourceRoot, 'cli/install-check.js')).href);
    if (findMissingDeps(pluginRoot).length) throw new Error('Fixture dependencies missing; refusing install path');
  }
  await import(pathToFileURL(target).href);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
