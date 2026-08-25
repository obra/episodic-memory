import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
});
