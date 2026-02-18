# Memory Safety: Defence in Depth

## Problem

Each Claude Code session spawns 2 MCP server processes (wrapper + server) and 1 background sync process (via SessionStart hook). With 3-5 concurrent sessions, that's 9-15 node processes. The MCP server eagerly loads @xenova/transformers at module level, and sync processes load the ONNX model for embedding generation. With 1000+ JSONL files to index on first sync, this produces 48-60GB of RAM usage on a 16GB laptop.

## Root Cause

1. **Eager import**: `src/embeddings.ts` has a top-level `import { pipeline } from '@xenova/transformers'` that Node evaluates at module load. Since the esbuild bundle marks it as `--external`, every MCP server process loads the ONNX runtime on boot, even when no search is requested.
2. **No sync deduplication**: The SessionStart hook spawns a detached sync process per session. Multiple sync processes run concurrently, each loading the ONNX model independently.
3. **Unbounded memory in sync**: The sync loop processes all files without pausing. ONNX runtime accumulates native memory across thousands of inference calls.
4. **No memory cap**: Node processes have no `--max-old-space-size` constraint, allowing V8 heaps to grow to ~4GB each.

## Design

### 1. Lazy dynamic import of @xenova/transformers

Replace the top-level import in `src/embeddings.ts` with a dynamic `import()` inside `initEmbeddings()`. MCP server processes that never handle a search request never load the ONNX runtime.

**Files**: `src/embeddings.ts`

### 2. Global lock file for sync

Before starting sync, acquire a lock file at `~/.episodic-memory/sync.lock` containing the owning PID. Behaviour:

- Lock exists, PID alive: log and exit 0
- Lock exists, PID dead: stale lock, remove and acquire
- No lock: create and proceed
- On exit: remove lock via `process.on('exit')`

PID liveness check via `process.kill(pid, 0)`.

Lock logic lives in `src/sync-cli.ts` (CLI coordination concern, not library).

**Files**: `src/sync-cli.ts`

### 3. Memory cap via --max-old-space-size

Add `--max-old-space-size=512` to node args in:

- `cli/mcp-server-wrapper.js` when spawning the MCP server child
- `src/sync-cli.ts` when spawning the detached background sync

This caps V8 heap only (ONNX native memory is outside V8's control). Acts as safety net for JS-side memory (parsed JSONL, embedding arrays).

**Files**: `cli/mcp-server-wrapper.js`, `src/sync-cli.ts`

### 4. Batch-and-pause in sync

After every 20 files, pause the indexing loop and:

1. Close and reopen the database (releases SQLite buffers)
2. Null the embedding pipeline via new `resetEmbeddings()` export, then call `global.gc()` — drops the ONNX session and reclaims JS garbage
3. Log `process.memoryUsage()` for observability

Next batch re-initialises the pipeline via `initEmbeddings()`. Reloading the model every 20 files adds ~2-3 seconds per batch (~2.5 minutes overhead over 1000 files).

Sync process needs `--expose-gc` in its node args to enable `global.gc()`.

**Files**: `src/embeddings.ts`, `src/sync.ts`, `src/sync-cli.ts`

## Expected Outcome

| Scenario | Before | After |
|-|-|-|
| MCP server (no search) | ~2GB (ONNX loaded) | ~50MB (no ONNX) |
| 5 sessions, no search | ~10GB MCP + sync | ~250MB MCP + 1 sync |
| First sync, 1000 files | Unbounded growth | ~512MB JS + periodic ONNX reset |
| Concurrent sync attempts | N parallel processes | 1 process, others skip |
