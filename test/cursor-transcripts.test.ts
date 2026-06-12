import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseConversation } from '../src/parser.js';

function writeJsonl(path: string, lines: unknown[]): void {
  writeFileSync(path, lines.map(line => JSON.stringify(line)).join('\n') + '\n', 'utf-8');
}

function liveCursorLines() {
  return [
    {
      role: 'user',
      message: {
        content: [
          {
            type: 'text',
            text: '<user_query>\nWhy does the vault APY calculation drift?\n</user_query>'
          }
        ]
      }
    },
    {
      role: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me look at the APY math first.' },
          {
            type: 'tool_use',
            name: 'Shell',
            input: {
              command: 'grep -rn "apy" src/',
              working_directory: '/Users/jesse/Documents/GitHub/example-org/example-project'
            }
          }
        ]
      }
    },
    // Noise lines that appear in real transcripts
    { type: 'status', status: 'completed' },
    { type: 'error', error: 'transient stream error' },
    {
      role: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'The drift comes from compounding per-block instead of per-second.' }
        ]
      }
    },
    {
      role: 'user',
      message: {
        content: [{ type: 'text', text: 'Can you fix it?' }]
      }
    },
    {
      role: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Done - switched to per-second compounding.' }]
      }
    }
  ];
}

describe('cursor agent transcripts', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cursor-transcripts-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeLiveTranscript(lines: unknown[]): string {
    // Mirror the real layout: <slug>/agent-transcripts/<uuid>/<uuid>.jsonl
    const sessionDir = join(
      tempDir,
      'Users-jesse-example-project',
      'agent-transcripts',
      '0a979b03-8327-4ca2-a7f5-f1ee2ec7212a'
    );
    mkdirSync(sessionDir, { recursive: true });
    const filePath = join(sessionDir, '0a979b03-8327-4ca2-a7f5-f1ee2ec7212a.jsonl');
    writeJsonl(filePath, lines);
    return filePath;
  }

  it('parses live transcripts into exchanges with cursor harness', async () => {
    const filePath = writeLiveTranscript(liveCursorLines());
    const exchanges = await parseConversation(filePath, 'fallback-project', filePath);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[0].harness).toBe('cursor');
    expect(exchanges[0].userMessage).toBe('Why does the vault APY calculation drift?');
    expect(exchanges[0].assistantMessage).toContain('per-block instead of per-second');
    expect(exchanges[1].userMessage).toBe('Can you fix it?');
  });

  it('strips the <user_query> wrapper from user messages', async () => {
    const filePath = writeLiveTranscript(liveCursorLines());
    const exchanges = await parseConversation(filePath, 'fallback-project', filePath);

    expect(exchanges[0].userMessage).not.toContain('<user_query>');
  });

  it('extracts tool calls and derives cwd from Shell working_directory', async () => {
    const filePath = writeLiveTranscript(liveCursorLines());
    const exchanges = await parseConversation(filePath, 'fallback-project', filePath);

    expect(exchanges[0].toolCalls).toHaveLength(1);
    expect(exchanges[0].toolCalls![0].toolName).toBe('Shell');
    expect(exchanges[0].cwd).toBe('/Users/jesse/Documents/GitHub/example-org/example-project');
    // Project comes from cwd basename, not the path slug or fallback
    expect(exchanges[0].project).toBe('example-project');
  });

  it('takes sessionId from the filename UUID', async () => {
    const filePath = writeLiveTranscript(liveCursorLines());
    const exchanges = await parseConversation(filePath, 'fallback-project', filePath);

    expect(exchanges[0].sessionId).toBe('0a979b03-8327-4ca2-a7f5-f1ee2ec7212a');
  });

  it('falls back to the path slug for project when no tool calls reveal cwd', async () => {
    const lines = [
      { role: 'user', message: { content: [{ type: 'text', text: 'hello' }] } },
      { role: 'assistant', message: { content: [{ type: 'text', text: 'hi there' }] } }
    ];
    const filePath = writeLiveTranscript(lines);
    const exchanges = await parseConversation(filePath, 'fallback-project', filePath);

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].project).toBe('Users-jesse-example-project');
  });

  it('uses file mtime as the exchange timestamp', async () => {
    const filePath = writeLiveTranscript(liveCursorLines());
    const mtime = new Date('2026-03-15T12:00:00.000Z');
    utimesSync(filePath, mtime, mtime);

    const exchanges = await parseConversation(filePath, 'fallback-project', filePath);
    expect(exchanges[0].timestamp).toBe('2026-03-15T12:00:00.000Z');
  });

  it('does not misdetect cursor files that start with a noise line', async () => {
    const lines = [
      { type: 'status', status: 'started' },
      ...liveCursorLines()
    ];
    const filePath = writeLiveTranscript(lines);
    const exchanges = await parseConversation(filePath, 'fallback-project', filePath);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[0].harness).toBe('cursor');
  });

  it('parses legacy exports with embedded timestamps, sessionId, and cwd', async () => {
    const projectDir = join(tempDir, 'legacy-project');
    mkdirSync(projectDir, { recursive: true });
    const filePath = join(projectDir, '1f512764-8211-4582-88f7-251df5e43bc9.jsonl');
    writeJsonl(filePath, [
      {
        role: 'user',
        message: { content: [{ type: 'text', text: 'Search git history for OwnershipTransferred' }] },
        timestamp: '2025-10-24T08:14:39.904Z',
        sessionId: '1f512764-8211-4582-88f7-251df5e43bc9',
        cwd: '/Users/jesse/Documents/GitHub/example-org/legacy-project'
      },
      {
        role: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Searching the commit history now.' },
            { type: 'tool_use', name: 'run_terminal_cmd', input: { command: 'git log --oneline' } }
          ]
        },
        timestamp: '2025-10-24T08:15:02.000Z',
        sessionId: '1f512764-8211-4582-88f7-251df5e43bc9',
        cwd: '/Users/jesse/Documents/GitHub/example-org/legacy-project'
      }
    ]);

    const exchanges = await parseConversation(filePath, 'fallback-project', filePath);

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].harness).toBe('cursor');
    expect(exchanges[0].timestamp).toBe('2025-10-24T08:15:02.000Z');
    expect(exchanges[0].sessionId).toBe('1f512764-8211-4582-88f7-251df5e43bc9');
    expect(exchanges[0].cwd).toBe('/Users/jesse/Documents/GitHub/example-org/legacy-project');
    expect(exchanges[0].project).toBe('legacy-project');
    expect(exchanges[0].toolCalls).toHaveLength(1);
    expect(exchanges[0].toolCalls![0].toolName).toBe('run_terminal_cmd');
  });

  it('still detects claude conversations correctly', async () => {
    const filePath = join(tempDir, 'claude-session.jsonl');
    writeJsonl(filePath, [
      {
        type: 'user',
        message: { role: 'user', content: 'Fix the build' },
        timestamp: '2026-01-01T00:00:00.000Z',
        sessionId: 'abc'
      },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed.' }] },
        timestamp: '2026-01-01T00:00:10.000Z'
      }
    ]);

    const exchanges = await parseConversation(filePath, 'claude-project', filePath);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].harness).toBe('claude');
  });
});
