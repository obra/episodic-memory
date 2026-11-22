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
  let originalCursorHome: string | undefined;
  let originalConfigDir: string | undefined;
  let originalTestProjectsDir: string | undefined;
  let originalTestDbPath: string | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-codex-test-'));
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    originalCodexHome = process.env.CODEX_HOME;
    originalCursorHome = process.env.CURSOR_HOME;
    originalConfigDir = process.env.EPISODIC_MEMORY_CONFIG_DIR;
    originalTestProjectsDir = process.env.TEST_PROJECTS_DIR;
    originalTestDbPath = process.env.TEST_DB_PATH;
  });

  afterEach(() => {
    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    if (originalCursorHome === undefined) delete process.env.CURSOR_HOME;
    else process.env.CURSOR_HOME = originalCursorHome;
    if (originalConfigDir === undefined) delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    else process.env.EPISODIC_MEMORY_CONFIG_DIR = originalConfigDir;
    if (originalTestProjectsDir === undefined) delete process.env.TEST_PROJECTS_DIR;
    else process.env.TEST_PROJECTS_DIR = originalTestProjectsDir;
    if (originalTestDbPath === undefined) delete process.env.TEST_DB_PATH;
    else process.env.TEST_DB_PATH = originalTestDbPath;

    rmSync(testDir, { recursive: true, force: true });
  });

  it('discovers Codex sessions alongside Claude transcript directories', () => {
    const claudeDir = join(testDir, 'claude');
    const codexHome = join(testDir, 'codex');
    const cursorHome = join(testDir, 'cursor');
    mkdirSync(join(claudeDir, 'projects'), { recursive: true });
    mkdirSync(join(codexHome, 'sessions'), { recursive: true });

    delete process.env.TEST_PROJECTS_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    process.env.CODEX_HOME = codexHome;
    process.env.CURSOR_HOME = cursorHome;
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir, 'superpowers');

    expect(getConversationSourceDirs()).toEqual([
      join(claudeDir, 'projects'),
      join(codexHome, 'sessions')
    ]);

    // Cursor directories join the scan once they exist
    mkdirSync(join(cursorHome, 'projects'), { recursive: true });
    expect(getConversationSourceDirs()).toEqual([
      join(claudeDir, 'projects'),
      join(codexHome, 'sessions'),
      join(cursorHome, 'projects')
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

describe('Codex transcripts - injected system items must not split an exchange', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'episodic-memory-codex-injected-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const meta = {
    timestamp: '2026-09-10T13:34:21.000Z',
    type: 'session_meta',
    payload: {
      id: '01a08b18-ea48-7e83-8503-3e21d476d9fa',
      timestamp: '2026-09-10T13:34:21.000Z',
      cwd: '/Users/testuser/Documents/GitHub/example-project',
      originator: 'codex_cli_rs',
      cli_version: '0.153.4',
      source: 'cli',
      model_provider: 'openai'
    }
  };
  const user = (text: string, ts: string) => ({
    timestamp: ts,
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
  });
  const userBlocks = (texts: string[], ts: string) => ({
    timestamp: ts,
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: texts.map(text => ({ type: 'input_text', text })) }
  });
  const assistant = (text: string, ts: string) => ({
    timestamp: ts,
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }
  });
  // Newer Codex builds log each typed prompt as an item_completed UserMessage event
  const userEvent = (text: string, ts: string) => ({
    timestamp: ts,
    type: 'event_msg',
    payload: { type: 'item_completed', item: { id: 'item_user_1', type: 'UserMessage', content: [{ type: 'text', text }] } }
  });
  const agentsMd = '# AGENTS.md instructions\n\n<INSTRUCTIONS>\n# Standing rules\nNothing leaves this machine.\n</INSTRUCTIONS>';
  const envContext = (cwd: string) => `<environment_context>\n  <cwd>${cwd}</cwd>\n  <shell>zsh</shell>\n</environment_context>`;
  const plugins = '<recommended_plugins>\nHere is a list of plugins the user may find useful.\n</recommended_plugins>';
  const skillBody = '<skill>\n<name>agent-chat</name>\n<path>/Users/testuser/.codex/skills/agent-chat/SKILL.md</path>\n---\nname: agent-chat\n---\n# Agent Chat\nCommands: register, send, read.\n</skill>';

  async function parse(lines: unknown[]) {
    const file = join(dir, 'rollout-2026-09-10T13-34-21-01a08b18-ea48-7e83-8503-3e21d476d9fa.jsonl');
    writeJsonl(file, lines);
    return parseConversation(file, '2026', file);
  }

  it('keeps the typed prompt when a <skill> body is injected before the reply (real rollout shape)', async () => {
    const exchanges = await parse([
      meta,
      user(agentsMd, '2026-09-10T13:34:21.100Z'),
      user(envContext('/Users/testuser/Documents/GitHub/example-project'), '2026-09-10T13:34:21.200Z'),
      user('register in agent-chat as episodic-codex', '2026-09-10T13:34:30.000Z'),
      userEvent('register in agent-chat as episodic-codex', '2026-09-10T13:34:30.100Z'),
      user(skillBody, '2026-09-10T13:34:31.000Z'),
      assistant('Registered as episodic-codex in the project room.', '2026-09-10T13:34:40.000Z')
    ]);

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].userMessage).toBe('register in agent-chat as episodic-codex');
    expect(exchanges[0].assistantMessage).toBe('Registered as episodic-codex in the project room.');
    expect(exchanges[0].lineStart).toBe(4);
    expect(exchanges[0].lineEnd).toBe(7);
    expect(exchanges[0].harness).toBe('codex');
  });

  it('ignores user-role context re-injected between turns (single and multi-block items)', async () => {
    const exchanges = await parse([
      meta,
      user('First question.', '2026-09-10T14:00:00.000Z'),
      assistant('First answer.', '2026-09-10T14:00:05.000Z'),
      userBlocks([plugins, envContext('/Users/testuser/Documents/GitHub/example-project')], '2026-09-10T14:01:00.000Z'),
      user('Second question.', '2026-09-10T14:01:01.000Z'),
      assistant('Second answer.', '2026-09-10T14:01:06.000Z')
    ]);

    expect(exchanges.map(e => [e.userMessage, e.assistantMessage])).toEqual([
      ['First question.', 'First answer.'],
      ['Second question.', 'Second answer.']
    ]);
    expect(exchanges[1].lineStart).toBe(5);
  });

  it('keeps a real request that shares an item with an injected block', async () => {
    const exchanges = await parse([
      meta,
      user('Warm-up.', '2026-09-10T14:10:00.000Z'),
      assistant('Ready.', '2026-09-10T14:10:02.000Z'),
      userBlocks([envContext('/Users/testuser/x'), 'Please rename the config loader.'], '2026-09-10T14:11:00.000Z'),
      assistant('Renamed.', '2026-09-10T14:11:04.000Z')
    ]);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[1].userMessage).toBe('Please rename the config loader.');
    expect(exchanges[1].assistantMessage).toBe('Renamed.');
  });

  it('does not mistake typed text for an injected item on its opening prefix alone', async () => {
    const exchanges = await parse([
      meta,
      user('Here is my pom.', '2026-09-10T14:20:00.000Z'),
      assistant('Go on.', '2026-09-10T14:20:02.000Z'),
      // A typed Maven snippet that opens like a wrapper tag, followed by the question
      user('<plugin>\n  <artifactId>maven-surefire-plugin</artifactId>\n</plugin>\nWhy are my tests skipped?', '2026-09-10T14:21:00.000Z'),
      assistant('Because skipTests is set.', '2026-09-10T14:21:05.000Z'),
      // A heading that merely resembles the AGENTS.md header
      user('# AGENTS.md instructions need cleanup\nPlease remove the obsolete setup instructions.', '2026-09-10T14:22:00.000Z'),
      assistant('Removed them.', '2026-09-10T14:22:05.000Z'),
      // A complete <skill>-like element the user pasted, but with trailing text
      user('<skill>\n<name>x</name>\n</skill>\nIs this the right skill format?', '2026-09-10T14:23:00.000Z'),
      assistant('Yes.', '2026-09-10T14:23:03.000Z')
    ]);

    expect(exchanges.map(e => e.userMessage)).toEqual([
      'Here is my pom.',
      '<plugin>\n  <artifactId>maven-surefire-plugin</artifactId>\n</plugin>\nWhy are my tests skipped?',
      '# AGENTS.md instructions need cleanup\nPlease remove the obsolete setup instructions.',
      '<skill>\n<name>x</name>\n</skill>\nIs this the right skill format?'
    ]);
  });

  it('trusts a UserMessage event over the content heuristic', async () => {
    const pasted = envContext('/Users/testuser/y'); // user pasted a complete wrapper block verbatim
    const exchanges = await parse([
      meta,
      user('Look at this.', '2026-09-10T14:30:00.000Z'),
      assistant('Looking.', '2026-09-10T14:30:02.000Z'),
      user(pasted, '2026-09-10T14:31:00.000Z'),
      userEvent(pasted, '2026-09-10T14:31:00.100Z'),
      assistant('That is an environment block.', '2026-09-10T14:31:05.000Z')
    ]);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[1].userMessage).toBe(pasted);
    expect(exchanges[1].lineStart).toBe(4);
    expect(exchanges[1].assistantMessage).toBe('That is an environment block.');
  });

  it('still treats user-input wrappers and image captions as prompts', async () => {
    const exchanges = await parse([
      meta,
      user('Look at the config.', '2026-09-10T15:00:00.000Z'),
      assistant('Looking.', '2026-09-10T15:00:03.000Z'),
      user('<user_shell_command>ls src</user_shell_command>', '2026-09-10T15:00:10.000Z'),
      assistant('parser.ts show.ts', '2026-09-10T15:00:12.000Z'),
      {
        timestamp: '2026-09-10T15:01:00.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [
          { type: 'input_text', text: '<image name=[Image #1] path="/tmp/codex-clipboard-B4BjBj.png">  ' },
          { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=' },
          { type: 'input_text', text: '</image>' },
          { type: 'input_text', text: '[Image #1] please enable experimental context management.' }
        ] }
      },
      assistant('Enabled.', '2026-09-10T15:01:04.000Z')
    ]);

    expect(exchanges).toHaveLength(3);
    expect(exchanges[1].userMessage).toContain('<user_shell_command>ls src</user_shell_command>');
    expect(exchanges[2].userMessage).toContain('please enable experimental context management');
  });

  it('treats several wrapper elements, or text between them, as user text (single-fragment rule)', async () => {
    const twoSkills = '<skill><name>old</name></skill>\nWhich definition should I keep?\n<skill><name>new</name></skill>';
    const exchanges = await parse([
      meta,
      user('Compare these.', '2026-09-10T14:40:00.000Z'),
      assistant('Paste them.', '2026-09-10T14:40:02.000Z'),
      user(twoSkills, '2026-09-10T14:41:00.000Z'),
      assistant('Keep the new definition.', '2026-09-10T14:41:05.000Z')
    ]);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[1].userMessage).toBe(twoSkills);
    expect(exchanges[1].assistantMessage).toBe('Keep the new definition.');
    expect(exchanges[0].assistantMessage).toBe('Paste them.');
  });

  it('restores the full authored prompt of a mixed item when a UserMessage event vouches for it', async () => {
    const env = envContext('/Users/testuser/wrong-dir');
    const question = 'Why is this pointing at the wrong directory?';
    const exchanges = await parse([
      meta,
      user('Hi.', '2026-09-10T14:50:00.000Z'),
      assistant('Hello.', '2026-09-10T14:50:02.000Z'),
      userBlocks([env, question], '2026-09-10T14:51:00.000Z'),
      {
        timestamp: '2026-09-10T14:51:00.100Z',
        type: 'event_msg',
        payload: { type: 'item_completed', item: { id: 'item_user_2', type: 'UserMessage', content: [
          { type: 'text', text: env }, { type: 'text', text: question }
        ] } }
      },
      assistant('Because cwd is stale.', '2026-09-10T14:51:05.000Z')
    ]);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[1].userMessage).toBe(`${env}\n${question}`);
    expect(exchanges[1].lineStart).toBe(4);
    expect(exchanges[1].assistantMessage).toBe('Because cwd is stale.');
  });

  it('lets an injected item open a session that has no prompt yet (unchanged behavior)', async () => {
    const exchanges = await parse([
      meta,
      user(envContext('/Users/testuser/x'), '2026-09-10T16:00:00.000Z'),
      assistant('Ready.', '2026-09-10T16:00:02.000Z'),
      user('Now the real prompt.', '2026-09-10T16:00:10.000Z'),
      assistant('Real answer.', '2026-09-10T16:00:14.000Z')
    ]);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[0].userMessage).toContain('<environment_context>');
    expect(exchanges[1].userMessage).toBe('Now the real prompt.');
  });
});
