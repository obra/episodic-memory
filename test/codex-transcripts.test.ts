import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { getConversationSourceDirs } from '../src/paths.js';
import { parseConversation } from '../src/parser.js';
import { initDatabase, insertExchange } from '../src/db.js';
import { ConversationExchange } from '../src/types.js';

function writeJsonl(path: string, lines: unknown[]): void {
  writeFileSync(path, lines.map(line => JSON.stringify(line)).join('\n') + '\n', 'utf-8');
}

function codexRolloutLines() {
  return [
    {
      timestamp: '2026-05-12T18:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
        timestamp: '2026-05-12T18:00:00.000Z',
        cwd: '/Users/jesse/Documents/GitHub/example-org/example-project',
        originator: 'codex_cli_rs',
        cli_version: '0.130.0',
        source: 'cli',
        model_provider: 'openai',
        git: {
          branch: 'codex-support'
        }
      }
    },
    {
      timestamp: '2026-05-12T18:00:01.000Z',
      type: 'turn_context',
      payload: {
        cwd: '/Users/jesse/Documents/GitHub/example-org/example-project',
        model: 'gpt-5.2',
        approval_policy: 'never',
        sandbox_policy: { mode: 'danger_full_access' },
        summary: { mode: 'auto' }
      }
    },
    {
      timestamp: '2026-05-12T18:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Please inspect the config loader.' }
        ]
      }
    },
    {
      timestamp: '2026-05-12T18:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [
          { type: 'summary_text', text: 'Need to inspect how config files are selected.' }
        ],
        encrypted_content: 'encrypted-thinking-block'
      }
    },
    {
      timestamp: '2026-05-12T18:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd":"sed -n 1,80p src/config.ts"}',
        call_id: 'call_config'
      }
    },
    {
      timestamp: '2026-05-12T18:00:05.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_config',
        output: 'export function loadConfig() {}'
      }
    },
    {
      timestamp: '2026-05-12T18:00:06.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'The config loader currently reads the default profile first.' }
        ]
      }
    }
  ];
}

function codexRolloutLinesWithLocalShell() {
  return [
    {
      timestamp: '2026-05-12T18:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
        cwd: '/Users/jesse/Documents/GitHub/example-org/example-project',
        cli_version: '0.130.0',
        model_provider: 'openai',
      }
    },
    {
      timestamp: '2026-05-12T18:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Run a local shell command.' }]
      }
    },
    {
      timestamp: '2026-05-12T18:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'local_shell_call',
        call_id: 'local_shell_1',
        action: { command: ['/bin/echo', 'local shell'] }
      }
    },
    {
      timestamp: '2026-05-12T18:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'local_shell_call_output',
        call_id: 'local_shell_1',
        output: 'Exit code: 0\nOutput:\nlocal shell'
      }
    },
    {
      timestamp: '2026-05-12T18:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Local shell command completed.' }]
      }
    }
  ];
}

describe('Codex transcript support', () => {
  let testDir: string;
  let originalClaudeConfigDir: string | undefined;
  let originalCodexHome: string | undefined;
  let originalTestProjectsDir: string | undefined;
  let originalTestDbPath: string | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-codex-test-'));
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    originalCodexHome = process.env.CODEX_HOME;
    originalTestProjectsDir = process.env.TEST_PROJECTS_DIR;
    originalTestDbPath = process.env.TEST_DB_PATH;
  });

  afterEach(() => {
    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    if (originalTestProjectsDir === undefined) delete process.env.TEST_PROJECTS_DIR;
    else process.env.TEST_PROJECTS_DIR = originalTestProjectsDir;
    if (originalTestDbPath === undefined) delete process.env.TEST_DB_PATH;
    else process.env.TEST_DB_PATH = originalTestDbPath;

    rmSync(testDir, { recursive: true, force: true });
  });

  it('discovers Codex sessions alongside Claude transcript directories', () => {
    const claudeDir = join(testDir, 'claude');
    const codexHome = join(testDir, 'codex');
    mkdirSync(join(claudeDir, 'projects'), { recursive: true });
    mkdirSync(join(codexHome, 'sessions'), { recursive: true });

    delete process.env.TEST_PROJECTS_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    process.env.CODEX_HOME = codexHome;

    expect(getConversationSourceDirs()).toEqual([
      join(claudeDir, 'projects'),
      join(codexHome, 'sessions')
    ]);
  });

  it('parses Codex rollout JSONL into an exchange with harness metadata', async () => {
    const rolloutPath = join(testDir, 'rollout-2026-05-12T18-00-00-019e4c75-d5bf-7c71-9df7-77f5fb86b711.jsonl');
    writeJsonl(rolloutPath, codexRolloutLines());

    const exchanges = await parseConversation(rolloutPath, '2026', rolloutPath);

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({
      harness: 'codex',
      project: 'example-project',
      sessionId: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
      cwd: '/Users/jesse/Documents/GitHub/example-org/example-project',
      gitBranch: 'codex-support',
      agentVersion: '0.130.0',
      model: 'gpt-5.2',
      modelProvider: 'openai',
      userMessage: 'Please inspect the config loader.',
      assistantMessage: 'The config loader currently reads the default profile first.'
    });
    expect(exchanges[0].toolCalls).toEqual([
      expect.objectContaining({
        exchangeId: exchanges[0].id,
        toolName: 'exec_command',
        toolInput: { cmd: 'sed -n 1,80p src/config.ts' },
        toolResult: 'export function loadConfig() {}',
        isError: false,
        timestamp: '2026-05-12T18:00:04.000Z'
      })
    ]);
  });

  it('pairs Codex local shell calls with their output', async () => {
    const rolloutPath = join(testDir, 'rollout-2026-05-12T18-00-00-019e4c75-d5bf-7c71-9df7-77f5fb86b711.jsonl');
    writeJsonl(rolloutPath, codexRolloutLinesWithLocalShell());

    const exchanges = await parseConversation(rolloutPath, '2026', rolloutPath);

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].toolCalls).toEqual([
      expect.objectContaining({
        exchangeId: exchanges[0].id,
        toolName: 'local_shell_call',
        toolInput: { command: ['/bin/echo', 'local shell'] },
        toolResult: 'Exit code: 0\nOutput:\nlocal shell',
        isError: false,
        timestamp: '2026-05-12T18:00:02.000Z'
      })
    ]);
  });

  it('stores harness and model metadata on indexed exchanges', () => {
    process.env.TEST_DB_PATH = join(testDir, 'index.sqlite');
    const db = initDatabase();

    const exchange: ConversationExchange = {
      id: 'codex-exchange-1',
      project: 'example-project',
      timestamp: '2026-05-12T18:00:06.000Z',
      userMessage: 'Question',
      assistantMessage: 'Answer',
      archivePath: '/tmp/rollout.jsonl',
      lineStart: 3,
      lineEnd: 7,
      harness: 'codex',
      sessionId: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
      agentVersion: '0.130.0',
      model: 'gpt-5.2',
      modelProvider: 'openai'
    };

    insertExchange(db, exchange, new Array(384).fill(0.1));

    const row = db.prepare(`
      SELECT harness, session_id, agent_version, model, model_provider
      FROM exchanges
      WHERE id = ?
    `).get(exchange.id) as {
      harness: string;
      session_id: string;
      agent_version: string;
      model: string;
      model_provider: string;
    };

    expect(row).toEqual({
      harness: 'codex',
      session_id: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
      agent_version: '0.130.0',
      model: 'gpt-5.2',
      model_provider: 'openai'
    });

    db.close();
  });
});
