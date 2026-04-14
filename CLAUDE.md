# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Episodic Memory is a Claude Code plugin that provides semantic search over past Claude Code conversations. It parses JSONL conversation files from `~/.claude/projects` and `~/.claude/transcripts`, generates vector embeddings locally using Transformers.js (`Xenova/all-MiniLM-L6-v2`, 384-dimensional), stores them in SQLite with sqlite-vec, and exposes search via CLI and MCP server.

This is a fork of [obra/episodic-memory](https://github.com/obra/episodic-memory).

## Build and Test

```bash
npm run build          # tsc + esbuild bundle of MCP server
npm test               # vitest run (30s timeout per test)
npm run test:watch     # vitest in watch mode
npx vitest run test/parser.test.ts              # single test file
npx vitest run test/parser.test.ts -t "parses"  # single test by name
```

The build has two steps: `tsc` compiles `src/` to `dist/`, then `esbuild` bundles `src/mcp-server.ts` into `dist/mcp-server.js` (ESM, with native modules externalized: better-sqlite3, sharp, onnxruntime-node, sqlite-vec, @xenova/transformers).

## Architecture

### Data Pipeline

Conversations flow through: **Sync** (copy from `~/.claude/`) -> **Parse** (extract user-agent exchanges from JSONL) -> **Summarize** (Claude API via `@anthropic-ai/claude-agent-sdk`) -> **Embed** (local Transformers.js) -> **Index** (SQLite + sqlite-vec) -> **Search** (vector similarity + text matching).

### Source Layout

- `src/` - TypeScript library (compiled to `dist/`)
  - `sync.ts` - Copies conversations from source dirs to archive, triggers indexing and summarization. Atomic copy via temp file + rename.
  - `parser.ts` - Parses JSONL conversation files into `ConversationExchange` objects. Extracts user/assistant messages, tool calls, session metadata.
  - `summarizer.ts` - Generates conversation summaries via Claude API. Short conversations (<=15 exchanges) summarized directly; long ones use hierarchical chunking (8 exchanges/chunk, then synthesis).
  - `embeddings.ts` - Local embedding generation with `@xenova/transformers`. Singleton pipeline initialization. Combines user + assistant + tool names into embedding text.
  - `db.ts` - SQLite database with `better-sqlite3` + `sqlite-vec`. Three tables: `exchanges`, `tool_calls`, `vec_exchanges`. Migrations via column existence checks.
  - `search.ts` - Vector similarity search (kNN via sqlite-vec) and LIKE text search. Multi-concept AND search searches each concept independently then intersects by archive path.
  - `mcp-server.ts` - MCP server exposing `search` and `read` tools over stdio transport. Input validation with Zod.
  - `paths.ts` - All filesystem path resolution. Respects env vars: `CLAUDE_CONFIG_DIR`, `EPISODIC_MEMORY_CONFIG_DIR`, `PERSONAL_SUPERPOWERS_DIR`, `XDG_CONFIG_HOME`.
  - `verify.ts` - Index health checks: finds missing summaries, orphaned DB entries, outdated files, corrupted conversations.

- `cli/` - Entry points (JavaScript, not compiled from src). `episodic-memory.js` dispatches subcommands to `dist/` scripts.

- `agents/`, `commands/`, `skills/`, `hooks/`, `prompts/` - Claude Code plugin integration files. The `search-conversations` agent is the primary interface for other Claude Code sessions to search history.

### Key Data Paths

| Location | Purpose |
|---|---|
| `~/.claude/projects/`, `~/.claude/transcripts/` | Source conversation files |
| `~/.config/superpowers/conversation-archive/` | Archived copies (organized by project) |
| `~/.config/superpowers/conversation-index/db.sqlite` | SQLite database with embeddings |

All paths are overridable via env vars (see `src/paths.ts`).

### Database

Three tables in SQLite:
- `exchanges` - Core data: messages, project, archive path, line range, session metadata
- `tool_calls` - Tool usage per exchange (FK to exchanges)
- `vec_exchanges` - sqlite-vec virtual table with 384-dim float embeddings

Schema migrations are additive (ALTER TABLE ADD COLUMN), checked on every `initDatabase()` call. See `docs/SCHEMA.md` for full schema.

### Search Mechanics

Vector search uses sqlite-vec kNN (`MATCH` + `k`). When date filters are present, the kNN `k` is multiplied by 50x because sqlite-vec applies k before SQL WHERE clauses. Similarity is computed as `max(0, 1 - (distance^2) / 2)` to convert L2 distance to a 0-1 similarity score.

Sidechain (subagent) exchanges are excluded from search results (`is_sidechain = 0`).

## Testing

Tests use `vitest` with `globals: true` (no need to import `describe`/`it`/`expect`). Test fixtures are JSONL files in `test/fixtures/`. Tests use env vars (`TEST_DB_PATH`, `TEST_PROJECTS_DIR`, `TEST_ARCHIVE_DIR`, `EPISODIC_MEMORY_CONFIG_DIR`) to isolate from real data. See `test/test-utils.ts` for helpers (`suppressConsole`, `createTestDb`, `getFixturePath`).

## Conversation Exclusion

Conversations containing `<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>` or the `SUMMARIZER_CONTEXT_MARKER` constant are archived but not indexed.

## MCP Server

Exposes two tools: `search` (semantic/text/both with date filters, multi-concept AND) and `read` (display conversation with optional line range pagination). Runs on stdio transport. The bundled version at `dist/mcp-server.js` is what gets used in production.
