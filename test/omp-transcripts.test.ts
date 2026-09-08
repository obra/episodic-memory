import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseConversation } from '../src/parser.js';
import { getConversationSourceDirs } from '../src/paths.js';

function writeLines(path: string, lines: unknown[]): void {
  writeFileSync(path, lines.map(line => JSON.stringify(line)).join('\n'), 'utf-8');
}

describe('OMP (Oh My Pi) transcript parser', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-omp-parser-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('parses a linear pi-lineage session into ordered exchanges, extracting text and skipping thinking', async () => {
    const transcriptPath = join(testDir, 'omp-linear.jsonl');
    const lines = [
      // L1
      { type: 'session', id: 'omp_sess_linear', timestamp: '2026-01-01T00:00:00Z', cwd: '/work/pi-project' },
      // L2 — root user
      {
        type: 'message',
        id: 'u1',
        parentId: null,
        timestamp: '2026-01-01T00:00:01Z',
        message: { role: 'user', content: [{ type: 'text', text: 'How does the tree walk work?' }] },
      },
      // L3 — assistant (thinking must be excluded)
      {
        type: 'message',
        id: 'a1',
        parentId: 'u1',
        timestamp: '2026-01-01T00:00:02Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'SECRET internal reasoning about the walk.' },
            { type: 'text', text: 'It follows parentId from leaf to root.' },
          ],
        },
      },
      // L4 — second user turn
      {
        type: 'message',
        id: 'u2',
        parentId: 'a1',
        timestamp: '2026-01-01T00:00:03Z',
        message: { role: 'user', content: [{ type: 'text', text: 'And then reverse it?' }] },
      },
      // L5 — leaf assistant
      {
        type: 'message',
        id: 'a2',
        parentId: 'u2',
        timestamp: '2026-01-01T00:00:04Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Yes, reverse to root->leaf order.' }] },
      },
    ];
    writeLines(transcriptPath, lines);

    const exchanges = await parseConversation(transcriptPath, 'fallback-project', transcriptPath);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]).toMatchObject({
      project: 'pi-project',
      harness: 'omp',
      sessionId: 'omp_sess_linear',
      cwd: '/work/pi-project',
      userMessage: 'How does the tree walk work?',
      assistantMessage: 'It follows parentId from leaf to root.',
      timestamp: '2026-01-01T00:00:02Z',
      lineStart: 2,
      lineEnd: 3,
    });
    expect(exchanges[0].assistantMessage).not.toContain('SECRET');
    expect(exchanges[1]).toMatchObject({
      harness: 'omp',
      userMessage: 'And then reverse it?',
      assistantMessage: 'Yes, reverse to root->leaf order.',
      lineStart: 4,
      lineEnd: 5,
    });
  });

  it('follows the active path only, excluding abandoned regenerated branches', async () => {
    const transcriptPath = join(testDir, 'omp-branched.jsonl');
    const lines = [
      // L1
      { type: 'session', id: 'omp_sess_branch', timestamp: '2026-02-01T00:00:00Z', cwd: '/work/branchy' },
      // L2 — root user
      {
        type: 'message',
        id: 'u1',
        parentId: null,
        timestamp: '2026-02-01T00:00:01Z',
        message: { role: 'user', content: [{ type: 'text', text: 'What is the capital of France?' }] },
      },
      // L3 — ABANDONED assistant answer (regenerated away); shares parent u1
      {
        type: 'message',
        id: 'a1_abandoned',
        parentId: 'u1',
        timestamp: '2026-02-01T00:00:02Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'The capital is BERLIN, definitely.' }] },
      },
      // L4 — SURVIVING assistant answer; also child of u1, appears after the abandoned one
      {
        type: 'message',
        id: 'a1_surviving',
        parentId: 'u1',
        timestamp: '2026-02-01T00:00:03Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'The capital is PARIS.' }] },
      },
      // L5 — user continues from the surviving branch
      {
        type: 'message',
        id: 'u2',
        parentId: 'a1_surviving',
        timestamp: '2026-02-01T00:00:04Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Tell me more.' }] },
      },
      // L6 — leaf (last message in file order): the active leaf
      {
        type: 'message',
        id: 'a2',
        parentId: 'u2',
        timestamp: '2026-02-01T00:00:05Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'PARIS sits on the Seine.' }] },
      },
    ];
    writeLines(transcriptPath, lines);

    const exchanges = await parseConversation(transcriptPath, 'fallback-project', transcriptPath);

    expect(exchanges).toHaveLength(2);
    const joined = exchanges.map(e => e.assistantMessage).join('\n');
    expect(joined).toContain('PARIS');
    expect(joined).not.toContain('BERLIN');
    // The surviving assistant is on line 4, not the abandoned line 3.
    expect(exchanges[0]).toMatchObject({
      userMessage: 'What is the capital of France?',
      assistantMessage: 'The capital is PARIS.',
      lineStart: 2,
      lineEnd: 4,
    });
    expect(exchanges[1]).toMatchObject({
      userMessage: 'Tell me more.',
      assistantMessage: 'PARIS sits on the Seine.',
      lineStart: 5,
      lineEnd: 6,
    });
  });

  it('skips title / session_init / custom line types without breaking parsing', async () => {
    const transcriptPath = join(testDir, 'omp-noise.jsonl');
    const lines = [
      // L1
      { type: 'session', id: 'omp_sess_noise', timestamp: '2026-03-01T00:00:00Z', cwd: '/work/noisy' },
      // L2 — noise
      { type: 'title', title: 'A generated title' },
      // L3 — user
      {
        type: 'message',
        id: 'u1',
        parentId: null,
        timestamp: '2026-03-01T00:00:01Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Does noise break the parser?' }] },
      },
      // L4 — noise
      { type: 'session_init', foo: 'bar' },
      // L5 — assistant leaf
      {
        type: 'message',
        id: 'a1',
        parentId: 'u1',
        timestamp: '2026-03-01T00:00:02Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'No, noise lines are skipped.' }] },
      },
      // L6 — custom noise after the leaf
      { type: 'some_custom_type', payloadish: { x: 1 } },
    ];
    writeLines(transcriptPath, lines);

    const exchanges = await parseConversation(transcriptPath, 'fallback-project', transcriptPath);

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({
      harness: 'omp',
      sessionId: 'omp_sess_noise',
      userMessage: 'Does noise break the parser?',
      assistantMessage: 'No, noise lines are skipped.',
      lineStart: 3,
      lineEnd: 5,
    });
  });
});

describe('OMP source directory discovery', () => {
  let testDir: string;
  let originalOmpHome: string | undefined;
  let originalTestProjectsDir: string | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-omp-paths-'));
    originalOmpHome = process.env.OMP_HOME;
    originalTestProjectsDir = process.env.TEST_PROJECTS_DIR;
    delete process.env.TEST_PROJECTS_DIR;
  });

  afterEach(() => {
    if (originalOmpHome === undefined) delete process.env.OMP_HOME;
    else process.env.OMP_HOME = originalOmpHome;
    if (originalTestProjectsDir === undefined) delete process.env.TEST_PROJECTS_DIR;
    else process.env.TEST_PROJECTS_DIR = originalTestProjectsDir;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('includes ~/.omp/agent/sessions (via OMP_HOME) when it exists', () => {
    process.env.OMP_HOME = testDir;
    const sessionsDir = join(testDir, 'agent', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    expect(getConversationSourceDirs(['omp'])).toEqual([sessionsDir]);
  });
});
