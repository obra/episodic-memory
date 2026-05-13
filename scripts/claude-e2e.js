#!/usr/bin/env node
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const MARKER = `purple-lantern-claude-e2e-${Date.now()}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const CLAUDE_BIN = resolveClaudeBin();

function die(message) {
  console.error(`claude-e2e: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout || ''}${result.stderr || ''}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function parseVersion(output) {
  return output.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
}

function compareSemver(a, b) {
  const left = a.split('.').map(part => Number.parseInt(part, 10));
  const right = b.split('.').map(part => Number.parseInt(part, 10));
  for (let i = 0; i < 3; i++) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function findCommandsOnPath(name) {
  const candidates = [];
  const seen = new Set();
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (seen.has(candidate) || !fs.existsSync(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }
  return candidates;
}

function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN) {
    return process.env.CLAUDE_BIN;
  }

  const candidates = findCommandsOnPath('claude');
  const withVersions = candidates.flatMap(candidate => {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf-8' });
    if (result.status !== 0) return [];
    const version = parseVersion(`${result.stdout || ''}${result.stderr || ''}`);
    return version ? [{ candidate, version }] : [];
  });

  withVersions.sort((a, b) => compareSemver(b.version, a.version));
  return withVersions[0]?.candidate || 'claude';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseClaudeOutput(output) {
  const messages = JSON.parse(output);
  const result = Array.isArray(messages) ? messages.find(message => message.type === 'result') : messages;
  if (!result) {
    throw new Error(`Claude output did not include a result message: ${output}`);
  }
  return result;
}

function encodedClaudeProjectDir(workspace) {
  return fs.realpathSync(workspace).replace(/\//g, '-');
}

function findTranscript(sessionId, workspace) {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const direct = path.join(projectsDir, encodedClaudeProjectDir(workspace), `${sessionId}.jsonl`);
  if (fs.existsSync(direct)) {
    return direct;
  }

  const stack = [projectsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir || !fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === `${sessionId}.jsonl`) {
        return fullPath;
      }
    }
  }

  throw new Error(`could not find Claude transcript for ${sessionId}`);
}

function countFiles(root, suffix) {
  if (!fs.existsSync(root)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath, suffix);
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      count++;
    }
  }
  return count;
}

function fileTreeContains(root, needle) {
  if (!fs.existsSync(root)) return false;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (fileTreeContains(fullPath, needle)) return true;
    } else if (entry.isFile() && fs.readFileSync(fullPath, 'utf-8').includes(needle)) {
      return true;
    }
  }
  return false;
}

async function waitFor(label, predicate, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(2000);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function runClaude(env, workspace, prompt) {
  const output = run(CLAUDE_BIN, [
    '-p',
    '--plugin-dir',
    REPO_ROOT,
    '--setting-sources',
    'project,local',
    '--dangerously-skip-permissions',
    '--output-format',
    'json',
    prompt,
  ], {
    cwd: workspace,
    env,
  });
  return { output, result: parseClaudeOutput(output) };
}

async function main() {
  if (process.env.EPISODIC_MEMORY_RUN_CLAUDE_E2E !== '1') {
    die('this test uses real Claude Code auth. Re-run with EPISODIC_MEMORY_RUN_CLAUDE_E2E=1 npm run test:claude-e2e');
  }

  if (!fs.existsSync(path.join(REPO_ROOT, 'dist', 'mcp-server.js'))) {
    die('dist/mcp-server.js is missing. Run npm run build first.');
  }

  const claudeVersionOutput = run(CLAUDE_BIN, ['--version']).trim();
  run(CLAUDE_BIN, ['plugin', 'validate', REPO_ROOT]);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'em-claude-plugin-e2e-'));
  const memoryDir = path.join(root, 'superpowers');
  const workspace = path.join(root, 'workspace');
  const codexHome = path.join(root, 'codex-empty');
  const sourceDir = path.join(root, 'source');
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });

  const env = {
    ...process.env,
    EPISODIC_MEMORY_CONFIG_DIR: memoryDir,
    TEST_PROJECTS_DIR: sourceDir,
    CODEX_HOME: codexHome,
  };
  delete env.CLAUDE_CONFIG_DIR;

  const seed = runClaude(
    env,
    workspace,
    `Reply exactly MEMORY_CLAUDE_SEED ${MARKER} and nothing else.`
  );
  if (seed.result.result !== `MEMORY_CLAUDE_SEED ${MARKER}`) {
    throw new Error(`seed session did not echo marker:\n${seed.output}`);
  }

  const seedTranscript = findTranscript(seed.result.session_id, workspace);
  const projectDir = path.basename(path.dirname(seedTranscript));
  const copiedProjectDir = path.join(sourceDir, projectDir);
  fs.mkdirSync(copiedProjectDir, { recursive: true });
  fs.copyFileSync(seedTranscript, path.join(copiedProjectDir, path.basename(seedTranscript)));

  const trigger = runClaude(
    env,
    workspace,
    'Reply exactly MEMORY_CLAUDE_TRIGGER and nothing else.'
  );
  if (trigger.result.result !== 'MEMORY_CLAUDE_TRIGGER') {
    throw new Error(`trigger session did not complete:\n${trigger.output}`);
  }

  const archiveRoot = path.join(memoryDir, 'conversation-archive');
  const dbPath = path.join(memoryDir, 'conversation-index', 'db.sqlite');
  await waitFor('archived Claude marker', () => fileTreeContains(archiveRoot, MARKER));
  await waitFor('Claude summaries', () => countFiles(archiveRoot, '-summary.txt') >= 1);
  await waitFor('conversation index database', () => fs.existsSync(dbPath));

  const recall = runClaude(
    env,
    workspace,
    `Use the episodic-memory remembering-conversations skill and its MCP search tool to search for ${MARKER}. If the search result contains MEMORY_CLAUDE_SEED, reply exactly FOUND_CLAUDE_MEMORY_E2E. If it does not, reply exactly NOT_FOUND_CLAUDE_MEMORY_E2E. Do not use shell commands.`
  );
  if (!String(recall.result.result).includes('FOUND_CLAUDE_MEMORY_E2E')) {
    throw new Error(`recall session failed:\n${recall.output}`);
  }
  if (!recall.output.includes('mcp__plugin_episodic-memory_episodic-memory__search')) {
    throw new Error('recall succeeded without evidence of an episodic-memory MCP search call in Claude output');
  }

  console.log(`Claude E2E passed in ${root}`);
  console.log(`Archived JSONLs: ${countFiles(archiveRoot, '.jsonl')}`);
  console.log(`Summaries: ${countFiles(archiveRoot, '-summary.txt')}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Seed session: ${seed.result.session_id}`);
  console.log(`Claude: ${CLAUDE_BIN} (${claudeVersionOutput})`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
