import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../dist/mcp-server.js', import.meta.url));

function buildMcpTestEnv(root: string): Record<string, string> {
  return {
    HOME: join(root, 'home'),
    USERPROFILE: join(root, 'home'),
    XDG_CONFIG_HOME: join(root, 'xdg-config'),
    XDG_DATA_HOME: join(root, 'xdg-data'),
    EPISODIC_MEMORY_CONFIG_DIR: join(root, 'config'),
    TEST_DB_PATH: join(root, 'db.sqlite'),
    TEST_ARCHIVE_DIR: join(root, 'archive'),
    TEST_PROJECTS_DIR: join(root, 'projects'),
  };
}

it('builds an isolated MCP child environment', () => {
  const root = join(tmpdir(), 'episodic-memory-mcp-test');
  const previousDbPath = process.env.EPISODIC_MEMORY_DB_PATH;
  process.env.EPISODIC_MEMORY_DB_PATH = join(root, 'inherited-db.sqlite');
  try {
    const env = buildMcpTestEnv(root);
    expect(env).toMatchObject({
      HOME: join(root, 'home'),
      USERPROFILE: join(root, 'home'),
      EPISODIC_MEMORY_CONFIG_DIR: join(root, 'config'),
      TEST_DB_PATH: join(root, 'db.sqlite'),
      TEST_ARCHIVE_DIR: join(root, 'archive'),
      TEST_PROJECTS_DIR: join(root, 'projects'),
    });
    expect(env).not.toHaveProperty('EPISODIC_MEMORY_DB_PATH');
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.EPISODIC_MEMORY_DB_PATH;
    } else {
      process.env.EPISODIC_MEMORY_DB_PATH = previousDbPath;
    }
  }
});

type ToolContent = { type: string; text?: string };

function getTextContent(content: ToolContent[]): string {
  const textItem = content.find((item) => item.type === 'text' && typeof item.text === 'string');
  expect(textItem?.text).toBeTruthy();
  return textItem!.text!;
}

describe('MCP search tool', () => {
  let client: Client;
  let transport: StdioClientTransport | undefined;
  let testDir: string | undefined;
  let testDbPath: string;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-mcp-'));
    testDbPath = join(testDir, 'db.sqlite');
    mkdirSync(join(testDir, 'archive'), { recursive: true });
    mkdirSync(join(testDir, 'projects'), { recursive: true });

    client = new Client({ name: 'episodic-memory-test', version: '1.0.0' }, { capabilities: {} });
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      stderr: 'pipe',
      env: buildMcpTestEnv(testDir),
    });
    await client.connect(transport);
  });

  afterAll(async () => {
    try {
      if (transport) {
        await transport.close();
      }
    } finally {
      if (testDir) {
        rmSync(testDir, { recursive: true, force: true });
      }
    }
  });

  it('enforces changed exclusions through the packaged MCP search entrypoint', async () => {
    const { initDatabase, insertExchange } = await import('../src/db.js');
    const priorDb = process.env.EPISODIC_MEMORY_DB_PATH;
    const priorTestDb = process.env.TEST_DB_PATH;
    const priorConfig = process.env.EPISODIC_MEMORY_CONFIG_DIR;
    const session = '00000000-1111-4222-8333-444444444444';
    const file = join(testDir!, `packaged-${session}.jsonl`);
    const policy = join(testDir!, 'config', 'record-exclusions.json');
    mkdirSync(join(testDir!, 'config'), { recursive: true });
    const original = [
      { type: 'session_meta', payload: { id: session } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'packaged-admission-probe' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'safe answer' }] } },
    ].map(row => JSON.stringify(row)).join('\n');
    writeFileSync(file, original);
    try {
      delete process.env.EPISODIC_MEMORY_DB_PATH;
      process.env.TEST_DB_PATH = testDbPath;
      process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir!, 'config');
      const db = initDatabase();
      insertExchange(db, { id: 'packaged-admission', project: 'fixture', timestamp: '2026-01-01T00:00:00Z',
        userMessage: 'packaged-admission-probe', assistantMessage: 'safe answer', archivePath: file,
        lineStart: 2, lineEnd: 3, sessionId: session }, new Array(384).fill(0.1));
      db.close();
      const search = () => client.callTool({ name: 'search', arguments: {
        query: 'packaged-admission-probe', mode: 'text', response_format: 'json', limit: 1,
      } });
      expect(JSON.parse(getTextContent((await search()).content as ToolContent[])).count).toBe(1);
      writeFileSync(policy, JSON.stringify({ version: 1, exchanges: [{ session_id: session,
        transcript: `packaged-${session}.jsonl`, line_start: 2, line_end: 3 }], tool_calls: [] }));
      const denied = await search(); expect(denied.isError).toBeFalsy();
      expect(JSON.parse(getTextContent(denied.content as ToolContent[])).count).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe(original);
    } finally {
      if (priorDb === undefined) delete process.env.EPISODIC_MEMORY_DB_PATH; else process.env.EPISODIC_MEMORY_DB_PATH = priorDb;
      if (priorTestDb === undefined) delete process.env.TEST_DB_PATH; else process.env.TEST_DB_PATH = priorTestDb;
      if (priorConfig === undefined) delete process.env.EPISODIC_MEMORY_CONFIG_DIR; else process.env.EPISODIC_MEMORY_CONFIG_DIR = priorConfig;
      if (existsSync(policy)) unlinkSync(policy);
    }
  });

  it('advertises search and read tools with single and multi-concept queries', async () => {
    const tools = await client.listTools();
    const searchTool = tools.tools.find((tool) => tool.name === 'search');

    expect(searchTool).toBeDefined();
    expect(tools.tools.some((tool) => tool.name === 'read')).toBe(true);
    expect(searchTool?.inputSchema?.properties?.query).toMatchObject({
      oneOf: [
        { type: 'string', minLength: 2 },
        { type: 'array', minItems: 2, maxItems: 5 },
      ],
    });
  });

  it('accepts single-concept searches without using the user database', async () => {
    const result = await client.callTool({
      name: 'search',
      arguments: {
        query: 'isolated search query',
        mode: 'text',
        limit: 1,
        response_format: 'json',
      },
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(getTextContent(result.content as ToolContent[]));
    expect(payload).toMatchObject({
      count: expect.any(Number),
      results: expect.any(Array),
      mode: 'text',
    });
    expect(existsSync(testDbPath)).toBe(true);
  });

  it('applies live record exclusions to direct reads and keeps physical range coordinates', async () => {
    const session = '00000000-1111-4222-8333-444444444444';
    const file = join(testDir!, `rollout-${session}.jsonl`);
    const config = join(testDir!, 'config', 'record-exclusions.json');
    mkdirSync(join(testDir!, 'config'), { recursive: true });
    const rows = [
      { type: 'session_meta', payload: { id: session } },
      ...['safe first', 'EXCLUDED_PUBLIC_FIXTURE', 'safe last'].map(text => ({ type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'text', text }] } })),
    ];
    const original = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
    writeFileSync(file, original);
    writeFileSync(config, JSON.stringify({ version: 1,
      exchanges: [{ session_id: session, transcript: `rollout-${session}.jsonl`, line_start: 3, line_end: 3 }], tool_calls: [] }));
    try {
      const result = await client.callTool({ name: 'read', arguments: { path: file } });
      expect(result.isError).toBeFalsy();
      const text = getTextContent(result.content as ToolContent[]);
      expect(text).not.toContain('EXCLUDED_PUBLIC_FIXTURE');
      expect(text).toContain('safe first');
      expect(text).toContain('safe last');
      const ranged = await client.callTool({ name: 'read', arguments: { path: file, startLine: 4, endLine: 4 } });
      expect(ranged.isError).toBeFalsy();
      const rangedText = getTextContent(ranged.content as ToolContent[]);
      expect(rangedText).toContain('safe last');
      expect(rangedText).not.toContain('safe first');
      expect(readFileSync(file, 'utf8')).toBe(original);
    } finally { unlinkSync(config); unlinkSync(file); }
  });
});
