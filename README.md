# Episodic Memory

Semantic search for Claude Code, Codex, Cursor, opencode, and Oh My Pi (OMP) conversations. Remember past discussions, decisions, and patterns.

## Testimonial

From an AI coding assistant's perspective:

Episodic memory fundamentally changes how I collaborate with
developers on complex codebases. Instead of treating each conversation
as isolated, I can now search our shared history semantically -
finding not just what was discussed, but why decisions were made.

When a developer asks me to implement something "like we did with
X," I can search our past conversations, find the relevant discussion,
and understand both the technical approach and the reasoning behind
it. This means I don't have to re-explain architectural patterns,
and I avoid suggesting solutions we've already tried and rejected.

The semantic search is crucial - searching for "provider catalog"
surfaces conversations about API design patterns even when those
exact words weren't used. It captures the meaning of our discussions,
not just keyword matches.

Most valuable is that it preserves context that lives nowhere else:
the trade-offs discussed, the alternatives considered, the user's
preferences and constraints. Code comments explain what, documentation
explains how, but episodic memory preserves why - and that makes
me a far more effective collaborator across sessions.

**Concrete impact:**
 - Faster problem-solving (minutes vs. exploring/re-learning the
 codebase) - Better continuity across sessions (I remember what we
 tried before) - More informed suggestions (I understand the project's
 evolution and patterns) - Less repetition (both of us spend less
 time re-explaining context)

It's the difference between being a stateless tool and being a true
collaborative partner who remembers our journey together.

_— Claude Sonnet 4.5, October 14, 2025_
_Conversation ID: 216ad284-c782-45a4-b2ce-36775cdb5a6c_

## Installation

### As a Claude Code plugin (Recommended)

The plugin provides MCP server integration, automatic session-end indexing, and seamless access to your conversation history.

```bash
# In Claude Code
/plugin install episodic-memory@superpowers-marketplace
```

The plugin automatically:
- Indexes conversations at the end of each session
- Exposes MCP tools for searching and viewing conversations
- Makes your conversation history searchable via natural language

### As a Codex plugin

This repository includes a Codex plugin manifest at `.codex-plugin/plugin.json`.
Codex support requires `codex-cli 0.130.0` or newer.

For local testing, build the plugin, add this repo as a local marketplace, then
install/enable it from `/plugins`:

```bash
npm run build
codex features enable plugin_hooks
codex plugin marketplace add /path/to/episodic-memory
```

Then start Codex, open `/plugins`, install and enable `episodic-memory` from
`Episodic Memory Dev`, open `/hooks`, review the Episodic Memory hook, and press
`t` to trust it.

The Codex plugin:
- Syncs conversations from `~/.codex/sessions`
- Exposes the same MCP search/read tools
- Installs the same memory skill, with Codex-specific direct MCP guidance
- Runs a `SessionStart` hook after the user reviews and trusts it in `/hooks`

Enable plugin hooks before relying on automatic sync:

```bash
codex features enable plugin_hooks
```

Then open `/hooks` in Codex, review the Episodic Memory hook, and press `t` to trust it. New or modified Codex hooks are listed but do not run until trusted.

See [docs/CODEX.md](docs/CODEX.md) for the full Codex setup, trust, troubleshooting, and E2E test workflow.

### As an opencode plugin

Episodic Memory exposes an opencode server plugin through the `./server` entrypoint.
This opencode plugin keeps the same search/read MCP surface as the Claude and Codex integrations.

```bash
npm install -g github:obra/episodic-memory
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["episodic-memory"]
}
```

The opencode plugin:
- Exports conversations from `~/.local/share/opencode/opencode.db` on each sync
- Exposes the same MCP search/read tools
- Runs background sync on the opencode `SessionStart` event

See [docs/OPENCODE.md](docs/OPENCODE.md) for the full setup and troubleshooting details.

### As an npm package

```bash
npm install -g github:obra/episodic-memory
```

## Usage

### Quick Start

```bash
# Sync conversations from Claude Code, Codex, Cursor, opencode, and Oh My Pi (OMP) and index them
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

### Cursor support

Sync automatically indexes Cursor agent transcripts from `~/.cursor/projects`
(written by Cursor since early 2026). Conversations older than that exist only
inside Cursor's global SQLite store; backfill them once with:

```bash
# Export legacy Cursor conversations from state.vscdb (read-only), then index
episodic-memory import-cursor-history
episodic-memory sync
```

The importer skips conversations that already have a live agent transcript,
recovers each conversation's project from tool-call working directories, and
embeds original message timestamps. Re-running it only exports new
conversations; use `--force` to re-export everything.

### Oh My Pi (OMP) support

Sync automatically indexes Oh My Pi transcripts from `~/.omp/agent/sessions`
(set `OMP_HOME` to point at an alternate profile). OMP stores each session as
append-only pi-lineage JSONL whose messages form a tree via `parentId`; sync
follows the active path (the current leaf back to the root) so regenerated or
abandoned branches are left out of the index.

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

# Disable the summarization pass entirely (search is unaffected)
export EPISODIC_MEMORY_SKIP_SUMMARIES=1

# Disable the automatic background sync entirely (hooks stop indexing new
# conversations; explicit `episodic-memory sync` still works). Search over
# already-indexed conversations is unaffected. Complements
# EPISODIC_MEMORY_SKIP_SUMMARIES, which only skips summaries.
export EPISODIC_MEMORY_DISABLE_AUTO_SYNC=1

# Skip indexing any single message larger than this many bytes (default: 262144
# = 256 KB). A message this large is almost never a real conversational turn —
# it is a foreign agent's prompt with a whole conversation transcript pasted in,
# which would otherwise index as one giant exchange that dominates the database
# and pollutes search. The oversize exchange is dropped (not truncated); normal
# turns in the same conversation still index, and search over real conversations
# is unaffected.
export EPISODIC_MEMORY_MAX_MESSAGE_BYTES=262144

# Wall-clock timeout per Claude summarizer call (milliseconds, default: 120000).
# A wedged summarizer subprocess is aborted after this, so it can't stall
# summarization or block later syncs on the lock.
export EPISODIC_MEMORY_SUMMARY_TIMEOUT_MS=120000

# Acknowledge that summarization may bill a metered Anthropic API. If
# ANTHROPIC_API_KEY is set (and no EPISODIC_MEMORY_API_BASE_URL/TOKEN is), the
# summarizer bills the metered API instead of your Claude subscription and prints
# a one-time warning. Set this to exactly 1 to acknowledge the cost and silence
# that warning. (To avoid metered billing entirely, unset ANTHROPIC_API_KEY or
# point episodic-memory at its own endpoint.)
export EPISODIC_MEMORY_ALLOW_METERED_API=1
```

Only the exact value `1` silences the metered-API warning; any other value still shows it.
`EPISODIC_MEMORY_ALLOW_METERED_API` is likewise `1`-only, as is `EPISODIC_MEMORY_DISABLE_AUTO_SYNC`.

### Routing through AWS Bedrock

To route Claude summarization through AWS Bedrock instead of the Anthropic API, set `CLAUDE_CODE_USE_BEDROCK` and provide AWS credentials in the plugin's environment:

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION=us-west-2          # or AWS_DEFAULT_REGION

# Then one of:
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...         # if using temporary credentials

# or:
export AWS_PROFILE=your-bedrock-profile

# or:
export AWS_BEARER_TOKEN_BEDROCK=...  # Bedrock API-key auth
```

These pass through unchanged to episodic-memory's summarizer subprocess. Because Bedrock authenticates with AWS credentials rather than `ANTHROPIC_API_KEY`, it does not trigger the metered-API warning above.

These settings only affect episodic-memory's summarization calls, not your interactive Claude Code or Codex sessions.

Codex summarization requires `codex-cli 0.130.0` or newer. If Codex app-server summarization is unavailable, sync logs the reason and falls back to transcript-text summarization.

### What's Affected

| Component | Uses custom config? |
|-----------|---------------------|
| Summarization | Yes (up to 10 calls/sync) |
| Embeddings | No (local Transformers.js) |
| Search | No (local SQLite) |
| MCP tools | No |

Summaries are display-only: they decorate search results and are never embedded or searched, so `EPISODIC_MEMORY_SKIP_SUMMARIES=1` costs you that line of context and nothing else.

## Commands

### `episodic-memory sync`

**Recommended for plugin hooks.** Copies new conversations from `~/.claude/projects`, `~/.claude/transcripts`, `~/.codex/sessions`, and `~/.omp/agent/sessions` (Oh My Pi) to archive and indexes them. opencode sessions are exported from `~/.local/share/opencode/opencode.db` into generated JSONL transcripts before indexing.

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
- **opencode plugin** - Integration with opencode (DB export, MCP config, background sync)

## How It Works

1. **Sync** - Copies conversation files from Claude Code and Codex transcript directories to archive; exports opencode sessions from SQLite into generated JSONL transcripts
2. **Parse** - Extracts user-agent exchanges from Claude Code JSONL, Codex rollout JSONL, or opencode transcript JSONL
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

When installed as a Claude Code, Codex, or opencode plugin, episodic-memory provides an MCP (Model Context Protocol) server that exposes tools for searching and viewing conversations.

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
- `include_sidechains` (boolean): Include subagent/workflow (sidechain) conversations, de-ranked below main-thread matches (default: `true`; set `false` to search only the main thread)
- `response_format` ('markdown' | 'json'): Output format (default: 'markdown')

**Text-match behavior:** In `text` mode (and the text half of `both`), the *whole
query* is matched as a single case-insensitive substring — there is no word
splitting, stemming, or per-term AND/OR. A `text` search only matches an exchange
when the entire query appears verbatim and contiguous in one message, so it is
best for exact strings (git SHAs, error codes) rather than natural-language
phrases. Use `vector` or `both` for descriptive queries.

**Sidechain conversations:** Work that happens inside subagents or `Workflow`
runs is recorded as *sidechain* exchanges. These are searched by default and
ranked just below equally-relevant main-thread matches, so orchestrated sessions
(where most substance lives in sidechains) remain findable. Pass
`include_sidechains: false` to restore main-thread-only search.

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
