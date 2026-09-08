import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the embeddings module so `initEmbeddings` fails the way it does on a host
// where sharp's native binding can't dlopen libvips (#135). sync.ts loads it via
// `await import('./embeddings.js')`, which vi.mock intercepts when registered
// before sync is loaded. A full factory replacement also keeps the real
// @huggingface/transformers / sharp out of the test entirely.
vi.mock('../src/embeddings.js', () => ({
  initEmbeddings: vi.fn().mockRejectedValue(
    new Error(
      'Failed to load the embedding backend (@huggingface/transformers). ' +
      'ERR_DLOPEN_FAILED: libvips-cpp.so.8.17.3: cannot open shared object file'
    )
  ),
  generateExchangeEmbedding: vi.fn(),
  generateQueryEmbedding: vi.fn(),
  generateEmbedding: vi.fn(),
  initEmbeddingsFailed: false,
}));

import { syncConversations } from '../src/sync.js';

function makeNonEmptyJsonl(sessionId: string): string {
  return [
    JSON.stringify({
      type: 'user',
      uuid: `${sessionId}-user-1`,
      parentUuid: null,
      timestamp: '2025-10-01T12:00:00Z',
      isSidechain: false,
      cwd: '/tmp/test-cwd',
      message: { role: 'user', content: 'What does the deploy script do?' },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: `${sessionId}-asst-1`,
      parentUuid: `${sessionId}-user-1`,
      timestamp: '2025-10-01T12:00:01Z',
      isSidechain: false,
      message: { role: 'assistant', content: [{ type: 'text', text: 'It deploys to prod via terraform apply.' }] },
    }),
  ].join('\n');
}

describe('sync command — embedding backend unavailable (#135)', () => {
  let testDir: string;
  let sourceDir: string;
  let destDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-embeddings-unavailable-'));
    sourceDir = join(testDir, 'source');
    destDir = join(testDir, 'dest');
    mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('does not throw when the embedding backend fails to load — copies the file, skips indexing, records a clear error', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const sessionId = '019aff97-5651-71e0-80ec-b4f2c51095c3';
    writeFileSync(join(sourceDir, 'project-a', `${sessionId}.jsonl`), makeNonEmptyJsonl(sessionId), 'utf-8');

    // Must resolve (not reject): a failed embedder previously threw out of
    // syncConversations and crashed the SessionStart hook that calls it.
    const result = await syncConversations(sourceDir, destDir, { skipSummaries: true });

    // Copying still happened — degradation is partial, not total.
    expect(result.copied).toBe(1);
    expect(existsSync(join(destDir, 'project-a', `${sessionId}.jsonl`))).toBe(true);

    // Nothing was indexed, because there is no embedder.
    expect(result.indexed).toBe(0);

    // The failure is surfaced (not swallowed), with an actionable message.
    const embErr = result.errors.find(e => e.file === '(embeddings)');
    expect(embErr).toBeDefined();
    expect(embErr!.error).toMatch(/embedding backend unavailable/i);
    expect(embErr!.error).toMatch(/libvips|sharp|transformers/i);
  });
});
