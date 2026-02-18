# Memory Safety Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent episodic-memory from consuming 48-60GB RAM when multiple Claude Code sessions are open.

**Architecture:** Defence in depth — four independent layers (lazy import, sync lock, memory cap, batch-and-pause) that each reduce memory pressure independently and compose for robust protection.

**Tech Stack:** TypeScript, Node.js, esbuild (bundle), vitest (tests)

---

### Task 1: Lazy dynamic import of @xenova/transformers

**Files:**
- Modify: `src/embeddings.ts:1`
- Modify: `test/embeddings.test.ts`

**Step 1: Update existing tests to work with dynamic import**

The existing tests in `test/embeddings.test.ts` already use `vi.doMock` + dynamic `import()` pattern, so they should continue to work. But we need to add a test that verifies `@xenova/transformers` is NOT imported until `initEmbeddings()` or `generateEmbedding()` is called.

Add this test to the existing describe block in `test/embeddings.test.ts`:

```typescript
it('should not import @xenova/transformers at module load time', async () => {
  let transformersImported = false;

  vi.doMock('@xenova/transformers', () => {
    transformersImported = true;
    const mockPipeline = vi.fn().mockResolvedValue({
      data: new Float32Array(384).fill(0.1),
      dispose: vi.fn()
    });
    return { pipeline: vi.fn().mockResolvedValue(mockPipeline) };
  });

  // Importing the module should NOT trigger @xenova/transformers import
  await import('../src/embeddings.js');
  expect(transformersImported).toBe(false);

  // Only when we actually generate an embedding should it load
  const { generateEmbedding } = await import('../src/embeddings.js');
  await generateEmbedding('test');
  expect(transformersImported).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/embeddings.test.ts`
Expected: FAIL — the new test fails because the current top-level import triggers module evaluation immediately.

**Step 3: Implement lazy import**

Replace `src/embeddings.ts` contents. The key change: remove the top-level `import { pipeline, ... } from '@xenova/transformers'` and replace with a dynamic `import()` inside `initEmbeddings()`.

```typescript
// No top-level import of @xenova/transformers — loaded lazily to avoid
// multi-GB ONNX runtime loading in MCP server processes that never search.

let embeddingPipeline: any = null;

export async function initEmbeddings(): Promise<void> {
  if (!embeddingPipeline) {
    console.log('Loading embedding model (first run may take time)...');
    const { pipeline } = await import('@xenova/transformers');
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
    console.log('Embedding model loaded');
  }
}

export function resetEmbeddings(): void {
  embeddingPipeline = null;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!embeddingPipeline) {
    await initEmbeddings();
  }

  // Truncate text to avoid token limits (512 tokens max for this model)
  const truncated = text.substring(0, 2000);

  const output = await embeddingPipeline!(truncated, {
    pooling: 'mean',
    normalize: true
  });

  const embedding = Array.from(output.data);

  // Free the ONNX tensor to prevent unbounded memory growth during batch operations.
  // dispose() exists at runtime but is missing from @xenova/transformers v2 type definitions.
  if (typeof output.dispose === 'function') {
    output.dispose();
  }

  return embedding;
}

export async function generateExchangeEmbedding(
  userMessage: string,
  assistantMessage: string,
  toolNames?: string[]
): Promise<number[]> {
  // Combine user question, assistant answer, and tools used for better searchability
  let combined = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;

  // Include tool names in embedding for tool-based searches
  if (toolNames && toolNames.length > 0) {
    combined += `\n\nTools: ${toolNames.join(', ')}`;
  }

  return generateEmbedding(combined);
}
```

Note: `resetEmbeddings()` is added here for Task 4 (batch-and-pause). It's a simple null assignment, no test needed beyond its use in Task 4.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/embeddings.test.ts`
Expected: All tests PASS including the new lazy-import test.

**Step 5: Commit**

```bash
git add src/embeddings.ts test/embeddings.test.ts
git commit -m "fix: lazy-load @xenova/transformers to prevent eager ONNX loading

MCP server processes that never handle search requests now stay at ~50MB
instead of loading the multi-GB ONNX runtime at module evaluation time."
```

---

### Task 2: Global lock file for sync

**Files:**
- Modify: `src/sync-cli.ts:40-58`
- Modify: `src/paths.ts` (add `getLockFilePath`)
- Create: `test/sync-lock.test.ts`

**Step 1: Add getLockFilePath to paths.ts**

Add to the end of `src/paths.ts`:

```typescript
/**
 * Get sync lock file path
 */
export function getLockFilePath(): string {
  return path.join(getSuperpowersDir(), 'sync.lock');
}
```

**Step 2: Write the failing test**

Create `test/sync-lock.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('sync lock file', () => {
  let testDir: string;
  let lockPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-lock-test-'));
    lockPath = join(testDir, 'sync.lock');
    process.env.EPISODIC_MEMORY_CONFIG_DIR = testDir;
  });

  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should acquire lock when no lock exists', async () => {
    const { acquireSyncLock, releaseSyncLock } = await import('../src/sync-lock.js');
    const acquired = acquireSyncLock();
    expect(acquired).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
    const content = readFileSync(lockPath, 'utf-8');
    expect(content).toBe(String(process.pid));
    releaseSyncLock();
  });

  it('should fail to acquire lock when another live process holds it', async () => {
    const { acquireSyncLock } = await import('../src/sync-lock.js');
    // Write lock with current PID (simulates another process — PID is alive)
    writeFileSync(lockPath, String(process.pid));
    const acquired = acquireSyncLock();
    expect(acquired).toBe(false);
  });

  it('should acquire lock when lock file has stale PID', async () => {
    const { acquireSyncLock, releaseSyncLock } = await import('../src/sync-lock.js');
    // PID 99999999 should not be alive
    writeFileSync(lockPath, '99999999');
    const acquired = acquireSyncLock();
    expect(acquired).toBe(true);
    releaseSyncLock();
  });

  it('should release lock by removing file', async () => {
    const { acquireSyncLock, releaseSyncLock } = await import('../src/sync-lock.js');
    acquireSyncLock();
    expect(existsSync(lockPath)).toBe(true);
    releaseSyncLock();
    expect(existsSync(lockPath)).toBe(false);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run test/sync-lock.test.ts`
Expected: FAIL — `../src/sync-lock.js` does not exist.

**Step 4: Implement sync-lock module**

Create `src/sync-lock.ts`:

```typescript
import fs from 'fs';
import { getLockFilePath } from './paths.js';

let activeLockPath: string | null = null;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireSyncLock(): boolean {
  const lockPath = getLockFilePath();

  if (fs.existsSync(lockPath)) {
    try {
      const existingPid = parseInt(fs.readFileSync(lockPath, 'utf-8').trim(), 10);
      if (!isNaN(existingPid) && existingPid !== process.pid && isProcessAlive(existingPid)) {
        console.error(`Sync already running (PID ${existingPid}), skipping.`);
        return false;
      }
      // Stale lock — remove it
      fs.unlinkSync(lockPath);
    } catch {
      // Lock file unreadable — remove it
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    }
  }

  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    activeLockPath = lockPath;
    return true;
  } catch (err: any) {
    if (err.code === 'EEXIST') {
      // Race condition: another process created it between our check and write
      console.error('Sync lock acquired by another process, skipping.');
      return false;
    }
    throw err;
  }
}

export function releaseSyncLock(): void {
  if (activeLockPath) {
    try {
      fs.unlinkSync(activeLockPath);
    } catch {
      // Already removed — fine
    }
    activeLockPath = null;
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run test/sync-lock.test.ts`
Expected: All tests PASS.

**Step 6: Wire lock into sync-cli.ts**

Modify `src/sync-cli.ts`. After the `--background` block (line 59) and before the sync execution (line 61), add lock acquisition:

```typescript
import { acquireSyncLock, releaseSyncLock } from './sync-lock.js';

// ... existing code up to line 59 ...

// Acquire sync lock — only one sync process at a time
if (!acquireSyncLock()) {
  process.exit(0);
}
process.on('exit', releaseSyncLock);

const sourceDir = path.join(os.homedir(), '.claude', 'projects');
// ... rest of existing code ...
```

**Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

**Step 8: Commit**

```bash
git add src/sync-lock.ts src/paths.ts src/sync-cli.ts test/sync-lock.test.ts
git commit -m "fix: add global lock file to prevent concurrent sync processes

Multiple Claude Code sessions firing the SessionStart hook would spawn
parallel sync processes, each loading the ONNX model independently.
Now only one sync runs at a time; others detect the lock and exit."
```

---

### Task 3: Memory cap via --max-old-space-size

**Files:**
- Modify: `cli/mcp-server-wrapper.js:79`
- Modify: `src/sync-cli.ts:48`
- Modify: `test/mcp-server-wrapper.test.ts`

**Step 1: Write failing test for wrapper memory cap**

Add to the existing describe block in `test/mcp-server-wrapper.test.ts`:

```typescript
it('should pass --max-old-space-size to MCP server child', () => {
  expect(wrapperCode).toContain('--max-old-space-size=');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp-server-wrapper.test.ts`
Expected: FAIL — wrapper doesn't contain `--max-old-space-size`.

**Step 3: Add memory cap to wrapper**

In `cli/mcp-server-wrapper.js`, change line 79 from:

```javascript
const child = spawn(process.execPath, [mcpServerPath], {
```

to:

```javascript
const child = spawn(process.execPath, ['--max-old-space-size=512', mcpServerPath], {
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/mcp-server-wrapper.test.ts`
Expected: PASS.

**Step 5: Add memory cap and --expose-gc to sync background spawn**

In `src/sync-cli.ts`, change the spawn args in the `isBackground` block from:

```typescript
const child = spawn(process.execPath, [
  process.argv[1], // This script
  ...filteredArgs
], {
```

to:

```typescript
const child = spawn(process.execPath, [
  '--max-old-space-size=512',
  '--expose-gc',
  process.argv[1], // This script
  ...filteredArgs
], {
```

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

**Step 7: Commit**

```bash
git add cli/mcp-server-wrapper.js src/sync-cli.ts test/mcp-server-wrapper.test.ts
git commit -m "fix: cap V8 heap at 512MB for MCP server and sync processes

Adds --max-old-space-size=512 to node args when spawning the MCP server
child and background sync. Also adds --expose-gc to sync for Task 4."
```

---

### Task 4: Batch-and-pause in sync

**Files:**
- Modify: `src/sync.ts:140-178` (indexing loop)
- Modify: `test/sync.test.ts`

**Step 1: Write failing test for batch reset**

Add to `test/sync.test.ts`. This test verifies that when indexing more files than the batch size, the sync still completes and indexes all of them (the batch reset is transparent to callers).

```typescript
it('should index files in batches and complete all of them', async () => {
  // Create 25 files (more than BATCH_SIZE of 20)
  const projectDir = join(sourceDir, 'batch-test');
  mkdirSync(projectDir, { recursive: true });

  for (let i = 0; i < 25; i++) {
    const conversation = JSON.stringify({
      type: 'user',
      uuid: `uuid-user-${i}`,
      parentUuid: null,
      timestamp: `2025-10-01T12:${String(i).padStart(2, '0')}:00Z`,
      isSidechain: false,
      message: { role: 'user', content: `Question ${i}` }
    }) + '\n' + JSON.stringify({
      type: 'assistant',
      uuid: `uuid-assistant-${i}`,
      parentUuid: `uuid-user-${i}`,
      timestamp: `2025-10-01T12:${String(i).padStart(2, '0')}:01Z`,
      isSidechain: false,
      message: { role: 'assistant', content: `Answer ${i}` }
    });
    writeFileSync(join(projectDir, `conv-${i}.jsonl`), conversation, 'utf-8');
  }

  // Initialize test database
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE exchanges (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      user_message TEXT NOT NULL,
      assistant_message TEXT NOT NULL,
      archive_path TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      last_indexed INTEGER
    )
  `);
  db.exec(`
    CREATE VIRTUAL TABLE vec_exchanges USING vec0(
      id TEXT PRIMARY KEY,
      embedding FLOAT[384]
    )
  `);
  db.close();

  const result = await syncConversations(sourceDir, destDir);

  expect(result.copied).toBe(25);
  expect(result.indexed).toBe(25);
  expect(result.errors).toHaveLength(0);
});
```

**Step 2: Run test to verify it passes (baseline)**

Run: `npx vitest run test/sync.test.ts`
Expected: PASS — this is a baseline test. The batching is a performance/memory change that should be transparent. If this test passes both before and after, we know we didn't break anything.

**Step 3: Implement batch-and-pause**

Modify `src/sync.ts`. Replace the indexing loop (lines 140-178) with batched version:

```typescript
  // Index copied files (unless skipIndex is set)
  if (!options.skipIndex && filesToIndex.length > 0) {
    const { initDatabase, insertExchange } = await import('./db.js');
    const { initEmbeddings, generateExchangeEmbedding, resetEmbeddings } = await import('./embeddings.js');
    const { parseConversation } = await import('./parser.js');

    const BATCH_SIZE = 20;

    for (let batchStart = 0; batchStart < filesToIndex.length; batchStart += BATCH_SIZE) {
      const batch = filesToIndex.slice(batchStart, batchStart + BATCH_SIZE);
      const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(filesToIndex.length / BATCH_SIZE);

      console.log(`\nIndexing batch ${batchNum}/${totalBatches} (${batch.length} files)...`);

      const db = initDatabase();
      await initEmbeddings();

      for (const file of batch) {
        try {
          if (shouldSkipConversation(file)) {
            continue;
          }

          const project = path.basename(path.dirname(file));
          const exchanges = await parseConversation(file, project, file);

          for (const exchange of exchanges) {
            const toolNames = exchange.toolCalls?.map(tc => tc.toolName);
            const embedding = await generateExchangeEmbedding(
              exchange.userMessage,
              exchange.assistantMessage,
              toolNames
            );
            insertExchange(db, exchange, embedding, toolNames);
          }

          result.indexed++;
        } catch (error) {
          result.errors.push({
            file,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      db.close();

      // Reset embedding pipeline to release ONNX native memory
      resetEmbeddings();

      // Force garbage collection if available (requires --expose-gc)
      if (typeof globalThis.gc === 'function') {
        globalThis.gc();
      }

      const mem = process.memoryUsage();
      console.log(`  Batch ${batchNum} complete. Memory: RSS=${Math.round(mem.rss / 1024 / 1024)}MB, Heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB`);
    }
  }
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/sync.test.ts`
Expected: All tests PASS including the new batch test.

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add src/sync.ts test/sync.test.ts
git commit -m "fix: batch indexing with periodic ONNX pipeline reset

Indexes files in batches of 20, closing the database and resetting the
embedding pipeline between batches. This releases ONNX native memory
that accumulates over thousands of inference calls, keeping the sync
process within reasonable memory bounds even for 1000+ files."
```

---

### Task 5: Rebuild dist and verify

**Files:**
- Modify: `dist/mcp-server.js` (via rebuild)
- Modify: `dist/sync-cli.js` (via rebuild)
- Modify: `dist/embeddings.js` (via rebuild)

**Step 1: Rebuild TypeScript**

Run: `npm run build`
Expected: Clean build with no errors.

**Step 2: Run full test suite one final time**

Run: `npx vitest run`
Expected: All tests PASS.

**Step 3: Verify the lazy import in the bundled output**

Run: `grep -n 'from "@xenova/transformers"' dist/mcp-server.js`
Expected: Should NOT appear as a top-level static import. Should appear inside a function body (dynamic import).

Run: `grep -n 'import("@xenova/transformers")' dist/mcp-server.js`
Expected: Should appear inside `initEmbeddings` function.

**Step 4: Verify memory cap in wrapper**

Run: `grep 'max-old-space-size' cli/mcp-server-wrapper.js`
Expected: `--max-old-space-size=512` present.

**Step 5: Commit dist files**

```bash
git add dist/
git commit -m "chore: rebuild dist with memory safety changes"
```

---

### Task 6: Copy to plugin cache and manual verification

**Step 1: Copy updated files to plugin directory**

```bash
cp cli/mcp-server-wrapper.js ~/.claude/plugins/cache/superpowers-marketplace/episodic-memory/1.0.15/cli/
cp dist/mcp-server.js ~/.claude/plugins/cache/superpowers-marketplace/episodic-memory/1.0.15/dist/
cp dist/sync-cli.js ~/.claude/plugins/cache/superpowers-marketplace/episodic-memory/1.0.15/dist/
cp dist/embeddings.js ~/.claude/plugins/cache/superpowers-marketplace/episodic-memory/1.0.15/dist/
```

Note: also copy any new files (sync-lock) that got bundled into dist/.

**Step 2: Restart Claude Code and monitor**

Open Activity Monitor. Start a Claude Code session. Verify:
- MCP server wrapper + child: should stay under 100MB each
- No duplicate sync processes
- If sync runs, memory should stay under ~800MB and show batch logging in stderr

**Step 3: Open a second session and verify**

Second session should NOT spawn a second sync (lock prevents it). Second MCP server should stay lightweight.
