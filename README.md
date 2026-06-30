# Episodic Memory

Semantic search for Claude Code, Codex, and opencode conversations.
Remember past discussions, decisions, and patterns without re-litigating them.

## At A Glance

| What | Value |
|---|---|
| Purpose | Remember conversations across Claude Code, Codex, and opencode |
| Storage | Local archive + SQLite index |
| Search | Semantic and text search, plus conversation replay |
| MCP | `search` and `read` tools |
| Sync | Automatic hooks for Claude, Codex, and opencode |

```text
Claude Code   Codex   opencode
     \          |        /
      \         |       /
       -> archive -> embeddings -> SQLite index -> MCP search/read
```

## Install

| Surface | Install |
|---|---|
| Claude Code | `/plugin install episodic-memory@superpowers-marketplace` |
| Codex | Build the repo, add the local marketplace, then enable `episodic-memory` from `/plugins` |
| opencode | `npm install -g github:obra/episodic-memory`, then add `plugin: ["episodic-memory"]` |

### Claude Code

The Claude plugin provides automatic session-end indexing and MCP server integration.

```bash
/plugin install episodic-memory@superpowers-marketplace
```

### Codex

This repository includes a Codex plugin manifest at `.codex-plugin/plugin.json`.
Codex support requires `codex-cli 0.130.0` or newer.

```bash
npm run build
codex features enable plugin_hooks
codex plugin marketplace add /path/to/episodic-memory
```

Then open `/plugins`, install and enable `episodic-memory` from `Episodic Memory Dev`, open `/hooks`, review the Episodic Memory hook, and press `t` to trust it.

### opencode

Episodic Memory exposes an opencode server plugin through the `./server` entrypoint.

```bash
npm install -g github:obra/episodic-memory
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["episodic-memory"]
}
```

See [docs/CODEX.md](docs/CODEX.md) and [docs/OPENCODE.md](docs/OPENCODE.md) for the full setup and troubleshooting details.

## Usage

### Quick Start

```bash
# Sync conversations from Claude Code, Codex, and opencode and index them
episodic-memory sync

# Search your conversation history
episodic-memory search "React Router authentication"

# View index statistics
episodic-memory stats

# Diagnose Codex or opencode setup
episodic-memory doctor codex
episodic-memory doctor opencode

# Display a conversation
episodic-memory show path/to/conversation.jsonl
```

### Command Line

```bash
# Unified command interface
episodic-memory <command> [options]

# Sync and index new conversations
episodic-memory sync

# Index conversations manually
episodic-memory index --cleanup

# Search conversations
episodic-memory search "React Router authentication"
episodic-memory search --text "exact phrase"
episodic-memory search --after 2025-09-01 "refactoring"

# Display a conversation in readable format
episodic-memory show path/to/conversation.jsonl
episodic-memory show --format html conversation.jsonl > output.html

# View statistics
episodic-memory stats
```

### Legacy Commands

The original commands are still available for backward compatibility:

```bash
episodic-memory-index
episodic-memory-search "query"
```

### In Claude Code, Codex, or opencode

The plugin automatically syncs and indexes conversations from the harness that starts it. Reference past work in natural conversation — the `remembering-conversations` skill dispatches the `search-conversations` agent automatically when recall is needed. Example prompts:

- "How did we handle authentication in React Router?"
- "The conversation about async testing patterns"
- "Error message about sqlite-vec initialization"
- "Git commit SHA for the routing refactor"

In Codex and opencode, the skill guides the agent to use the episodic-memory MCP search/read tools directly when an agent-dispatch path is not available.

## API Configuration

By default, episodic-memory uses your Claude Code authentication for Claude Code summarization. Codex-indexed sessions with a session ID are summarized through `codex app-server` by creating an ephemeral `thread/fork`, so the summary can use Codex session context and reasoning summaries without appending to the original rollout.

To route summarization through a custom Anthropic-compatible endpoint or override the model:

```bash
# Override model (default: haiku)
export EPISODIC_MEMORY_API_MODEL=opus

# Override fallback model on error (default: sonnet)
export EPISODIC_MEMORY_API_MODEL_FALLBACK=sonnet

# Route through custom endpoint
export EPISODIC_MEMORY_API_BASE_URL=https://your-endpoint.com/api/anthropic
export EPISODIC_MEMORY_API_TOKEN=your-token

# Increase timeout for slow endpoints (milliseconds)
export EPISODIC_MEMORY_API_TIMEOUT_MS=3000000

# Override Codex binary path if needed (default: codex)
export EPISODIC_MEMORY_CODEX_BIN=/path/to/codex
```

These settings only affect episodic-memory's summarization calls, not your interactive Claude Code or Codex sessions.

Codex summarization requires `codex-cli 0.130.0` or newer. If Codex app-server summarization is unavailable, sync logs the reason and falls back to transcript-text summarization.

### What's Affected

| Component | Uses custom config? |
|-----------|---------------------|
| Summarization | Yes (up to 10 calls/sync) |
| Embeddings | No (local Transformers.js) |
| Search | No (local SQLite) |
| MCP tools | No |

## Commands

### `episodic-memory sync`

**Recommended for plugin hooks.** Copies new conversations from `~/.claude/projects`, `~/.claude/transcripts`, `~/.codex/sessions`, and generated opencode transcripts to archive and indexes them. opencode sessions are exported from `~/.local/share/opencode/opencode.db` before indexing.

Features:
- Only copies new or modified files (fast on subsequent runs)
- Generates embeddings for semantic search
- Atomic operations - safe to run concurrently
- Idempotent - safe to call repeatedly
- Background hook output is written to `~/.config/superpowers/logs/episodic-memory.log` unless `EPISODIC_MEMORY_CONFIG_DIR` changes the memory directory

**Usage in Claude Code:**
Add to `.claude/hooks/session-end`:
```bash
#!/bin/bash
episodic-memory sync
```

### `episodic-memory stats`

Display index statistics including conversation counts, date ranges, and project breakdown.

```bash
episodic-memory stats
```

### `episodic-memory doctor`

Diagnose local integration issues.

```bash
episodic-memory doctor codex
episodic-memory doctor opencode
```

The Codex doctor checks the Codex version, plugin hook feature state, MCP server registration, transcript directory, database path, and background sync log path.
The opencode doctor checks the opencode version, plugin configuration, MCP server registration, SQLite database path, generated transcript directory, and background sync log path.

### Codex E2E Verification

The repository includes an opt-in live Codex E2E test. It creates an isolated temporary `CODEX_HOME`, installs a copied plugin bundle, trusts the hook, runs Codex sessions in `tmux`, and verifies archive -> summary -> index -> MCP recall.

```bash
npm run build
EPISODIC_MEMORY_RUN_CODEX_E2E=1 npm run test:codex-e2e
```

### Claude E2E Verification

The repository also includes an opt-in live Claude Code E2E test. It loads this repo as a session plugin with `--plugin-dir`, constrains the hook to a temporary transcript source, and verifies archive -> summary -> index -> MCP recall.

```bash
npm run build
EPISODIC_MEMORY_RUN_CLAUDE_E2E=1 npm run test:claude-e2e
```

This test uses your normal Claude Code auth and writes small test transcripts to your normal Claude transcript directory. The archive and index are isolated in a temporary `EPISODIC_MEMORY_CONFIG_DIR`.

### `episodic-memory index`

Manual indexing tools for bulk operations and maintenance. See `episodic-memory index --help` for full options.

Common operations:
- `--cleanup` - Index all unprocessed conversations
- `--verify` - Check index health
- `--repair` - Fix detected issues

### `episodic-memory search`

Search indexed conversations using semantic similarity or exact text matching. See `episodic-memory search --help` for full options.

### `episodic-memory show`

Display a conversation from a JSONL file in human-readable format.

**Options:**
- `--format markdown` (default) - Plain text markdown output suitable for terminal or Claude
- `--format html` - Pretty HTML output for viewing in a browser

**Examples:**
```bash
# View in terminal
episodic-memory show conversation.jsonl | less

# Generate HTML for browser
episodic-memory show --format html conversation.jsonl > output.html
open output.html
```

## Architecture

- **Core package** - TypeScript library for indexing and searching conversations
- **CLI tools** - Unified command-line interface for manual use
- **MCP Server** - Model Context Protocol server exposing search and conversation tools
- **Claude Code plugin** - Integration with Claude Code (auto-indexing, MCP tools, hooks)
- **Codex plugin** - Integration with Codex (manifest, MCP config, hooks, skills)

## How It Works

1. **Sync** - Copies conversation files from Claude Code and Codex transcript directories to archive
2. **Parse** - Extracts user-agent exchanges from Claude Code JSONL or Codex rollout JSONL
3. **Embed** - Generates vector embeddings using Transformers.js (local, offline)
4. **Index** - Stores in SQLite with sqlite-vec for fast similarity search
5. **Search** - Semantic search using vector similarity or exact text matching

## Excluding Conversations

Conversations containing this marker anywhere in their content will be archived but not indexed:

```
<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>
```

**Automatic exclusions:**
- Conversations where Claude generates summaries (marker in system prompt)
- Meta-conversations about conversation processing

**Use cases:**
- Sensitive work conversations
- Tool invocation sessions (summarization, analysis)
- Test or experimental sessions
- Any conversation you don't want searchable

The marker can appear in any message (user or assistant) and excludes the entire conversation from the search index.

## MCP Server

When installed as a Claude Code or Codex plugin, episodic-memory provides an MCP (Model Context Protocol) server that exposes tools for searching and viewing conversations.

### Available MCP Tools

#### `search`

Search indexed conversations using semantic similarity or exact text matching.

**Single-concept search**: Pass a string query
```json
{
  "query": "React Router authentication",
  "mode": "vector",
  "limit": 10
}
```

**Multi-concept AND search**: Pass an array of concepts
```json
{
  "query": ["React Router", "authentication", "JWT"],
  "limit": 10
}
```

**Parameters:**
- `query` (string | string[]): Single string for regular search, or array of 2-5 strings for multi-concept AND search
- `mode` ('vector' | 'text' | 'both'): Search mode for single-concept searches (default: 'both')
- `limit` (number): Max results, 1-50 (default: 10)
- `after` (string, optional): Only show conversations after YYYY-MM-DD
- `before` (string, optional): Only show conversations before YYYY-MM-DD
- `response_format` ('markdown' | 'json'): Output format (default: 'markdown')

#### `read`

Display a full conversation in readable markdown format.

```json
{
  "path": "/path/to/conversation.jsonl"
}
```

**Parameters:**
- `path` (string): Absolute path to the JSONL conversation file

### Using the MCP Server Directly

The MCP server can also be used outside of Claude Code with any MCP-compatible client:

```bash
# Run the MCP server (stdio transport)
episodic-memory-mcp-server
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## License

MIT
