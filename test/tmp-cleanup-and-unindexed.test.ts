import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { syncConversations } from '../src/sync.js';
import { verifyIndex, repairIndex } from '../src/verify.js';
import { summarizeConversation } from '../src/summarizer.js';
import { suppressConsole } from './test-utils.js';

vi.mock('../src/embeddings.js', () => ({
  initEmbeddings: vi.fn(async () => {}),
  generateExchangeEmbedding: vi.fn(async () => new Array(384).fill(0.1))
}));

vi.mock('../src/summarizer.js', () => ({
  summarizeConversation: vi.fn(async () => 'Mock summary')
}));

const restoreConsole = suppressConsole();

function line(obj: object): string {
  return JSON.stringify(obj);
}

function toolUseConversation(extraTurns = 0): string {
  const lines = [
    line({ type: 'user', message: { role: 'user', content: 'List the files' }, timestamp: '2024-01-01T00:00:00Z' }),
    line({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Listing.' },
          { type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'ls' } },
          { type: 'tool_use', name: 'Read', input: { file_path: 'a.txt' } } // no id: hashed fallback
        ]
      },
      timestamp: '2024-01-01T00:00:01Z'
    })
  ];
  for (let i = 0; i < extraTurns; i++) {
    lines.push(line({ type: 'user', message: { role: 'user', content: `more ${i}` }, timestamp: `2024-01-01T00:01:0${i}Z` }));
    lines.push(line({ type: 'assistant', message: { role: 'assistant', content: `done ${i}` }, timestamp: `2024-01-01T00:02:0${i}Z` }));
  }
  return lines.join('\n') + '\n';
}

describe('no orphan .tmp copies, unindexed conversations', () => {
  let testDir: string;
  let archiveDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-memory-fixes-test-'));
    archiveDir = path.join(testDir, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(path.join(testDir, 'projects'), { recursive: true });
    process.env.TEST_PROJECTS_DIR = path.join(testDir, 'projects');
    process.env.TEST_ARCHIVE_DIR = archiveDir;
    process.env.TEST_DB_PATH = path.join(testDir, 'db.sqlite');
    vi.mocked(summarizeConversation).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.TEST_ARCHIVE_DIR;
    delete process.env.TEST_DB_PATH;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('leaves no .tmp copy behind when the rename onto the archive copy fails', async () => {
    const source = path.join(testDir, 'source', 'project');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'conv.jsonl'), toolUseConversation());
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    });

    const result = await syncConversations(path.join(testDir, 'source'), archiveDir, { skipIndex: true, skipSummaries: true });

    expect(rename).toHaveBeenCalled();
    expect(result.copied).toBe(1);
    const files = fs.readdirSync(path.join(archiveDir, 'project'));
    expect(files.filter(f => /\.tmp\.\d+$/.test(f))).toEqual([]);
    expect(fs.readFileSync(path.join(archiveDir, 'project', 'conv.jsonl'), 'utf-8')).toBe(toolUseConversation());
  });

  it('reports an archived conversation with a summary but no rows as unindexed, and repair indexes it without summarizing', async () => {
    const project = path.join(archiveDir, 'project');
    fs.mkdirSync(project, { recursive: true });
    const conv = path.join(project, 'conv.jsonl');
    fs.writeFileSync(conv, toolUseConversation());
    fs.writeFileSync(conv.replace('.jsonl', '-summary.txt'), 'An existing summary');
    // An empty summary is the permanent-skip sentinel: never reported as unindexed.
    fs.writeFileSync(path.join(project, 'empty.jsonl'), line({ type: 'summary', summary: 'x' }) + '\n');
    fs.writeFileSync(path.join(project, 'empty-summary.txt'), '');

    const before = await verifyIndex();
    expect(before.unindexed.map(u => u.path)).toEqual([conv]);
    expect(before.missing).toEqual([]);

    await repairIndex(before);

    expect(summarizeConversation).not.toHaveBeenCalled();
    expect(fs.readFileSync(conv.replace('.jsonl', '-summary.txt'), 'utf-8')).toBe('An existing summary');
    const after = await verifyIndex();
    expect(after.unindexed).toEqual([]);
  });
  afterAll(() => restoreConsole());
});
