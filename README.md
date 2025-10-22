# Episodic Memory

Semantic search for Claude Code conversations. Remember past discussions, decisions, and patterns.

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

### As an npm package

```bash
npm install episodic-memory
```

## Usage

### Quick Start

```bash
# Sync conversations from Claude Code and index them
episodic-memory sync

# Search your conversation history
episodic-memory search "React Router authentication"

# View index statistics
episodic-memory stats

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

### In Claude Code

The plugin automatically indexes conversations at session end. Use the search command:

```
/search-conversations
```

Or reference past work in natural conversation - Claude will search when appropriate.

## Commands

### `episodic-memory sync`

**Recommended for session-end hooks.** Copies new conversations from `~/.claude/projects` to archive and indexes them.

Features:
- Only copies new or modified files (fast on subsequent runs)
- Generates embeddings for semantic search
- Atomic operations - safe to run concurrently
- Idempotent - safe to call repeatedly

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

## How It Works

1. **Sync** - Copies conversation files from `~/.claude/projects` to archive
2. **Parse** - Extracts user-agent exchanges from JSONL format
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

When installed as a Claude Code plugin, episodic-memory provides an MCP (Model Context Protocol) server that exposes tools for searching and viewing conversations.

### Available MCP Tools

#### `episodic_memory_search`

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

#### `episodic_memory_show`

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
