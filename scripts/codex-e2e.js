#!/usr/bin/env node
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const MIN_CODEX_VERSION = '0.130.0';
const MARKER = 'purple-lantern-codex-archive-20260512';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function die(message) {
  console.error(`codex-e2e: ${message}`);
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function copyPlugin(dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(REPO_ROOT, dest, {
    recursive: true,
    filter: source => {
      const relative = path.relative(REPO_ROOT, source);
      if (!relative) return true;
      return !relative.split(path.sep).includes('.git');
    },
  });
}

function sourceCodexHome(targetCodexHome) {
  const configured = process.env.CODEX_HOME;
  if (configured && path.resolve(configured) !== path.resolve(targetCodexHome)) {
    return configured;
  }
  return path.join(os.homedir(), '.codex');
}

function copyCodexAuth(targetCodexHome) {
  const sourceHome = sourceCodexHome(targetCodexHome);
  const authPath = path.join(sourceHome, 'auth.json');
  if (!fs.existsSync(authPath)) {
    die(`Codex auth was not found at ${authPath}. Run codex login before the live E2E test.`);
  }

  for (const filename of ['auth.json', 'installation_id', 'models_cache.json']) {
    const source = path.join(sourceHome, filename);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(targetCodexHome, filename));
    }
  }
}

function writeBaseConfig(codexHome) {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, 'config.toml'),
    `model = "gpt-5.5"
approval_policy = "never"
sandbox_mode = "read-only"

[analytics]
enabled = false

[features]
plugins = true
plugin_hooks = true

[plugins."episodic-memory@test"]
enabled = true
`,
    'utf-8'
  );
}

function appendHookTrust(codexHome, hook) {
  fs.appendFileSync(
    path.join(codexHome, 'config.toml'),
    `
[hooks.state."${hook.key}"]
trusted_hash = "${hook.currentHash}"
`,
    'utf-8'
  );
}

async function withAppServer(env, callback) {
  const child = spawn('codex', ['app-server'], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let stderr = '';
  let nextId = 1;

  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  rl.on('line', line => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message.id === 'number' && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(JSON.stringify(message.error)));
      } else {
        entry.resolve(message.result);
      }
    }
  });

  const send = (method, params) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  const notify = method => {
    child.stdin.write(JSON.stringify({ method }) + '\n');
  };

  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
  }, 30000);

  try {
    await send('initialize', {
      clientInfo: { name: 'episodic-memory-e2e', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    });
    notify('initialized');
    return await callback(send);
  } catch (error) {
    throw new Error(`${error.message}\n${stderr}`);
  } finally {
    clearTimeout(timeout);
    rl.close();
    child.kill('SIGTERM');
  }
}

async function discoverPluginHook(env, workspace) {
  const result = await withAppServer(env, send => send('hooks/list', { cwds: [workspace] }));
  const hooks = result?.data?.[0]?.hooks || [];
  const hook = hooks.find(candidate => candidate.pluginId === 'episodic-memory@test');
  if (!hook) {
    throw new Error(`hooks/list did not return the episodic-memory plugin hook: ${JSON.stringify(result)}`);
  }
  return hook;
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

async function waitFor(label, predicate, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(2000);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function tmuxSessionName(prefix) {
  return `em-${prefix}-${Date.now()}`;
}

async function runCodexInTmux(env, workspace, prompt, outputPath) {
  const session = tmuxSessionName('codex');
  const statusPath = `${outputPath}.status`;
  const envPrefix = [
    `CODEX_HOME=${shellQuote(env.CODEX_HOME)}`,
    `EPISODIC_MEMORY_CONFIG_DIR=${shellQuote(env.EPISODIC_MEMORY_CONFIG_DIR)}`,
    `CLAUDE_CONFIG_DIR=${shellQuote(env.CLAUDE_CONFIG_DIR)}`,
  ].join(' ');
  const command = [
    `cd ${shellQuote(workspace)}`,
    `${envPrefix} codex exec --skip-git-repo-check ${shellQuote(prompt)} > ${shellQuote(outputPath)} 2>&1`,
    `printf '%s' $? > ${shellQuote(statusPath)}`,
  ].join('; ');

  run('tmux', ['new-session', '-d', '-s', session, command]);

  await waitFor(`tmux session ${session}`, () => fs.existsSync(statusPath), 240000);
  const status = fs.readFileSync(statusPath, 'utf-8').trim();
  const output = fs.readFileSync(outputPath, 'utf-8');
  if (status !== '0') {
    throw new Error(`codex tmux session failed with ${status}\n${output}`);
  }
  return { session, output };
}

function rolloutFiles(codexHome) {
  const sessionsDir = path.join(codexHome, 'sessions');
  const files = [];
  const visit = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath);
    }
  };
  visit(sessionsDir);
  return files;
}

function hasMcpRecall(codexHome) {
  return rolloutFiles(codexHome).some(file => {
    const content = fs.readFileSync(file, 'utf-8');
    return content.includes('mcp__episodic_memory__') &&
      content.includes('purple-lantern-codex-archive-20260512') &&
      content.includes('FOUND_MEMORY_E2E');
  });
}

async function main() {
  if (process.env.EPISODIC_MEMORY_RUN_CODEX_E2E !== '1') {
    die('this test uses a real Codex session. Re-run with EPISODIC_MEMORY_RUN_CODEX_E2E=1 npm run test:codex-e2e');
  }

  if (!fs.existsSync(path.join(REPO_ROOT, 'dist', 'mcp-server.js'))) {
    die('dist/mcp-server.js is missing. Run npm run build first.');
  }

  const codexVersionOutput = run('codex', ['--version']).trim();
  const codexVersion = parseVersion(codexVersionOutput);
  if (!codexVersion || compareSemver(codexVersion, MIN_CODEX_VERSION) < 0) {
    die(`codex-cli >= ${MIN_CODEX_VERSION} is required; found ${codexVersionOutput || 'unknown'}`);
  }
  run('tmux', ['-V']);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'em-codex-plugin-e2e-'));
  const codexHome = path.join(root, 'codex-home');
  const memoryDir = path.join(root, 'superpowers');
  const claudeDir = path.join(root, 'claude-empty');
  const workspace = path.join(root, 'workspace');
  const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'test', 'episodic-memory', 'local');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });

  copyPlugin(pluginRoot);
  copyCodexAuth(codexHome);
  writeBaseConfig(codexHome);

  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    EPISODIC_MEMORY_CONFIG_DIR: memoryDir,
    CLAUDE_CONFIG_DIR: claudeDir,
  };

  const hook = await discoverPluginHook(env, workspace);
  appendHookTrust(codexHome, hook);

  const mcpList = run('codex', ['mcp', 'list'], { env });
  if (!mcpList.includes('episodic-memory') || !mcpList.includes('enabled')) {
    throw new Error(`episodic-memory MCP server not enabled:\n${mcpList}`);
  }

  const seed = await runCodexInTmux(
    env,
    workspace,
    `Reply exactly MEMORY_E2E_SEED ${MARKER} and nothing else.`,
    path.join(root, 'seed.out')
  );
  if (!seed.output.includes(`MEMORY_E2E_SEED ${MARKER}`)) {
    throw new Error(`seed session did not echo marker:\n${seed.output}`);
  }

  const trigger = await runCodexInTmux(
    env,
    workspace,
    'Reply exactly MEMORY_E2E_TRIGGER and nothing else.',
    path.join(root, 'trigger.out')
  );
  if (!trigger.output.includes('MEMORY_E2E_TRIGGER')) {
    throw new Error(`trigger session did not complete:\n${trigger.output}`);
  }

  const archiveRoot = path.join(memoryDir, 'conversation-archive');
  const dbPath = path.join(memoryDir, 'conversation-index', 'db.sqlite');
  await waitFor('archived Codex JSONLs', () => countFiles(archiveRoot, '.jsonl') >= 2);
  await waitFor('Codex summaries', () => countFiles(archiveRoot, '-summary.txt') >= 1);
  await waitFor('conversation index database', () => fs.existsSync(dbPath));

  const recall = await runCodexInTmux(
    env,
    workspace,
    `Use the episodic-memory remembering-conversations skill and its MCP search tool to search for ${MARKER}. If the search result contains MEMORY_E2E_SEED, reply exactly FOUND_MEMORY_E2E. If it does not, reply exactly NOT_FOUND_MEMORY_E2E. Do not use shell commands.`,
    path.join(root, 'recall.out')
  );
  if (!recall.output.includes('FOUND_MEMORY_E2E')) {
    throw new Error(`recall session failed:\n${recall.output}`);
  }
  if (!hasMcpRecall(codexHome)) {
    throw new Error('recall succeeded without evidence of an episodic-memory MCP search call in the transcript');
  }

  console.log(`Codex E2E passed in ${root}`);
  console.log(`Archived JSONLs: ${countFiles(archiveRoot, '.jsonl')}`);
  console.log(`Summaries: ${countFiles(archiveRoot, '-summary.txt')}`);
  console.log(`Database: ${dbPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
