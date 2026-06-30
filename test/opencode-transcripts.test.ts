import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseConversation } from '../src/parser.js';

describe('opencode transcript parser', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-opencode-parser-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('parses exported opencode JSONL into exchanges with harness metadata and tool calls', async () => {
    const transcriptPath = join(testDir, 'opencode.jsonl');
    const lines = [
      {
        type: 'opencode_session',
        session: {
          id: 'ses_test123',
          directory: '/work/example-project',
          title: 'Test Session',
          version: '1.17.8',
          agent: 'build',
          model: { id: 'claude-sonnet-4-5', providerID: 'anthropic', variant: 'default' },
          time: { created: 1700000000000, updated: 1700000004000 },
        },
      },
      {
        type: 'opencode_message',
        message: {
          id: 'msg_user',
          role: 'user',
          time: { created: 1700000001000 },
          agent: 'build',
        },
        parts: [
          {
            id: 'prt_user_text',
            type: 'text',
            text: 'How should we export opencode memory?',
          },
        ],
      },
      {
        type: 'opencode_message',
        message: {
          id: 'msg_assistant',
          role: 'assistant',
          time: { created: 1700000002000, completed: 1700000003000 },
          modelID: 'claude-sonnet-4-5',
          providerID: 'anthropic',
          agent: 'build',
          path: { cwd: '/work/example-project', root: '/work/example-project' },
        },
        parts: [
          { id: 'prt_step', type: 'step-start' },
          {
            id: 'prt_tool',
            type: 'tool',
            callID: 'call_123',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { command: 'echo ok' },
              output: 'ok\n',
              time: { start: 1700000002100, end: 1700000002200 },
            },
          },
          {
            id: 'prt_reasoning',
            type: 'reasoning',
            text: 'Internal reasoning should not be indexed.',
          },
          {
            id: 'prt_assistant_text',
            type: 'text',
            text: 'Export opencode sessions as generated JSONL.',
          },
        ],
      },
    ];
    writeFileSync(transcriptPath, lines.map(line => JSON.stringify(line)).join('\n'), 'utf-8');

    const exchanges = await parseConversation(transcriptPath, 'opencode', transcriptPath);

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({
      project: 'example-project',
      harness: 'opencode',
      sessionId: 'ses_test123',
      cwd: '/work/example-project',
      agentVersion: '1.17.8',
      model: 'claude-sonnet-4-5',
      modelProvider: 'anthropic',
      userMessage: 'How should we export opencode memory?',
      assistantMessage: 'Export opencode sessions as generated JSONL.',
      lineStart: 2,
      lineEnd: 3,
    });
    expect(exchanges[0].assistantMessage).not.toContain('Internal reasoning');
    expect(exchanges[0].toolCalls).toEqual([
      expect.objectContaining({
        id: 'call_123',
        toolName: 'bash',
        toolInput: { command: 'echo ok' },
        toolResult: 'ok\n',
        isError: false,
      }),
    ]);
  });
});
