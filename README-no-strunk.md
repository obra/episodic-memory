# episodic-memory

Semantic search for Claude Code conversations. Index and search your entire conversation history to find relevant discussions, solutions, and context from past sessions.

## Overview

`episodic-memory` provides powerful semantic search capabilities for Claude Code conversation archives. It indexes your conversations, generates AI-powered summaries, and enables natural language search to help you find relevant past discussions instantly.

## Features

- **Semantic Search**: Find conversations by meaning, not just keywords
- **AI-Powered Summaries**: Automatically generates concise summaries of conversations
- **Fast Local Embeddings**: Uses efficient local models (no API calls for embeddings)
- **Multiple Search Modes**: Vector similarity, text matching, or combined search
- **Date Filtering**: Search within specific time ranges
- **Conversation Viewer**: Display conversations in beautiful HTML or Markdown formats
- **Incremental Indexing**: Only processes new conversations
- **Project Exclusion**: Configure which projects to skip during indexing

## Installation

```bash
npm install -g episodic-memory
```

Or install locally in your project:

```bash
npm install episodic-memory
```

## Quick Start

### 1. Index Your Conversations

First, index your existing conversations (this will process only unindexed conversations):

```bash
episodic-memory index --cleanup
```

For faster indexing with parallel summarization:

```bash
episodic-memory index --cleanup --concurrency 8
```

To skip AI summaries (free, but no summaries in search results):

```bash
episodic-memory index --cleanup --no-summaries
```

### 2. Search Your History

Semantic search finds conversations by meaning:

```bash
episodic-memory search "React Router authentication errors"
```

Search within a date range:

```bash
episodic-memory search --after 2025-09-01 "refactoring patterns"
```

Exact text matching (useful for git SHAs, error codes):

```bash
episodic-memory search --text "a1b2c3d4"
```

Combine both search modes:

```bash
episodic-memory search --both "React Router data loading"
```

### 3. View a Conversation

Display a conversation as formatted HTML:

```bash
episodic-memory show --format html conversation.jsonl > output.html
```

Or as Markdown:

```bash
episodic-memory show --format markdown conversation.jsonl
```

## CLI Reference

### Index Command

```bash
episodic-memory index [OPTIONS]
```

**Options:**
- `--cleanup` - Process only unindexed conversations (recommended)
- `--session ID` - Index a specific session
- `--concurrency N` - Parallel summarization (1-16, default: 1)
- `-c N` - Short form of `--concurrency`
- `--no-summaries` - Skip AI summary generation
- `--verify` - Check index health
- `--repair` - Fix detected issues
- `--rebuild` - Delete database and re-index everything

**Examples:**

```bash
# Initial setup (recommended)
episodic-memory index --cleanup

# Fast parallel indexing
episodic-memory index --cleanup --concurrency 8

# Index without AI summaries
episodic-memory index --cleanup --no-summaries

# Health check
episodic-memory index --verify
```

### Search Command

```bash
episodic-memory search [OPTIONS] <query>
```

**Options:**
- `--text` - Exact string matching
- `--both` - Combine vector + text search
- `--after DATE` - Only conversations after YYYY-MM-DD
- `--before DATE` - Only conversations before YYYY-MM-DD
- `--limit N` - Max results (default: 10)

**Examples:**

```bash
# Semantic search
episodic-memory search "debugging async race conditions"

# Exact text search
episodic-memory search --text "TypeError: Cannot read"

# Time-filtered search
episodic-memory search --after 2025-09-01 --limit 20 "performance optimization"
```

### Show Command

```bash
episodic-memory show [OPTIONS] <conversation.jsonl>
```

**Options:**
- `--format html|markdown` - Output format (default: html)

**Examples:**

```bash
# Generate HTML view
episodic-memory show --format html conversation.jsonl > output.html

# Display as Markdown
episodic-memory show --format markdown conversation.jsonl
```

## Configuration

### Excluding Projects

You can exclude specific projects from indexing:

**Using environment variable:**
```bash
export CONVERSATION_SEARCH_EXCLUDE_PROJECTS="project1,project2,project3"
```

**Using config file:**

Create `~/.config/superpowers/episodic-memory/exclude-projects.txt`:
```
# Projects to exclude from indexing
project1
project2
project3
```

### Data Locations

- **Conversations**: `~/.claude/projects/`
- **Archive**: `~/.config/superpowers/conversation-archive/`
- **Database**: `~/.config/superpowers/episodic-memory/conversations.db`
- **Config**: `~/.config/superpowers/episodic-memory/`

## Programmatic Usage

You can also use `episodic-memory` as a library in your Node.js projects:

```typescript
import { searchConversations, indexConversations } from 'episodic-memory';

// Search conversations
const results = await searchConversations('React Router', {
  limit: 10,
  mode: 'vector', // 'vector' | 'text' | 'both'
  after: '2025-09-01',
  before: '2025-10-01'
});

results.forEach(result => {
  console.log(result.exchange.project);
  console.log(result.summary);
  console.log(result.similarity);
});

// Index conversations
await indexConversations(
  'myproject',  // optional: limit to specific project
  100,          // optional: max conversations to process
  4,            // concurrency for summaries
  false         // noSummaries flag
);
```

## How It Works

1. **Parsing**: Reads Claude Code conversation files (.jsonl format) from `~/.claude/projects/`
2. **Archiving**: Copies conversations to a stable archive location
3. **Summarization**: Uses Claude API to generate concise summaries of conversations
4. **Embedding**: Generates vector embeddings using local transformer models
5. **Indexing**: Stores conversations, embeddings, and metadata in SQLite with sqlite-vec
6. **Searching**: Performs vector similarity search or text matching to find relevant conversations

## Performance Tips

- Use `--concurrency` for faster initial indexing (recommended: 4-8)
- Use `--cleanup` mode for incremental updates (only processes new conversations)
- Skip `--no-summaries` for faster indexing if you don't need AI-generated summaries
- Run `--verify` periodically to check index health

## Troubleshooting

### Index health check
```bash
episodic-memory index --verify
```

### Repair index issues
```bash
episodic-memory index --repair
```

### Full rebuild (nuclear option)
```bash
episodic-memory index --rebuild
```

### Check what's being indexed
The indexer shows progress as it runs:
- Which projects are being processed
- Number of conversations found
- Summary generation progress
- Final statistics

## Development

### Build
```bash
npm run build
```

### Test
```bash
npm test
```

### Test with watch mode
```bash
npm run test:watch
```

## Requirements

- Node.js 18+
- Claude Code (for conversation files)
- Anthropic API key (for conversation summaries, unless using `--no-summaries`)

## License

MIT

## Author

Jesse Vincent <jesse@fsck.com>

## Repository

https://github.com/obra/episodic-memory
