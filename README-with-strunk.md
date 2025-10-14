# episodic-memory

Semantic search for Claude Code conversations. Find past discussions using natural language queries or exact text matching.

## What It Does

`episodic-memory` indexes your Claude Code conversations and lets you search them by meaning, not just keywords. Ask "how did we implement authentication?" and find the relevant conversation, even if it never used the word "authentication."

## Features

- **Semantic search** - Find conversations by concept, not exact words
- **Text search** - Locate specific phrases, git SHAs, error messages
- **Combined search** - Use both methods simultaneously
- **Date filtering** - Search within specific time ranges
- **Conversation summaries** - AI-generated summaries improve search accuracy
- **Auto-indexing** - Claude Code plugin indexes conversations automatically

## Installation

```bash
npm install -g episodic-memory
```

### As a Claude Code Plugin

```bash
# Via marketplace
/plugin marketplace add obra/superpowers-marketplace
/plugin install episodic-memory@superpowers-marketplace
```

The plugin auto-indexes conversations after each session and provides `/search-conversations` command.

## Usage

### Command Line

```bash
# Index your conversations (first time setup)
episodic-memory index --cleanup

# Semantic search
episodic-memory search "React Router authentication"

# Exact text search (for SHAs, error messages)
episodic-memory search --text "TypeError: Cannot read"

# Date filtering
episodic-memory search --after 2025-09-01 "refactoring"
episodic-memory search --before 2025-10-13 "Docker setup"

# Display a conversation
episodic-memory show path/to/conversation.jsonl
episodic-memory show --format html conversation.jsonl > output.html
```

### Programmatic

```typescript
import { searchConversations, indexConversations } from 'episodic-memory';

// Index conversations
await indexConversations();

// Search with semantic similarity
const results = await searchConversations('database migration patterns', {
  limit: 10,
  mode: 'vector'
});

// Search with exact text matching
const textResults = await searchConversations('git SHA a1b2c3d', {
  mode: 'text'
});

// Combined search with date filter
const filtered = await searchConversations('authentication', {
  mode: 'both',
  after: '2025-09-01',
  before: '2025-10-01',
  limit: 20
});
```

## How It Works

1. **Parser** - Reads Claude Code conversation files (`.jsonl` format)
2. **Embeddings** - Generates vector embeddings using Transformers.js
3. **Summarizer** - Creates AI summaries of conversations via Claude API
4. **Database** - Stores conversations in SQLite with `sqlite-vec` for vector search
5. **Search** - Finds relevant exchanges using semantic similarity or text matching

## Commands

### `episodic-memory index`

Index conversations for search. Options:

- `--cleanup` - Remove orphaned database entries
- `--concurrency N` - Process N summaries in parallel (default: 1)
- `--no-summaries` - Skip AI summary generation
- `--project NAME` - Index only specific project
- `--unprocessed` - Index only new conversations
- `--session ID` - Index specific session

### `episodic-memory search`

Search indexed conversations. Options:

- `--text` - Use exact text matching instead of semantic search
- `--both` - Use both semantic and text search
- `--after YYYY-MM-DD` - Filter to conversations after date
- `--before YYYY-MM-DD` - Filter to conversations before date
- `--limit N` - Return at most N results (default: 10)

### `episodic-memory show`

Display conversation in readable format. Options:

- `--format html|markdown|text` - Output format (default: markdown)

## Configuration

Database location: `~/.config/episodic-memory/conversations.db`

Archive location: `~/.config/episodic-memory/archive/`

Conversations are read from: `~/.claude/projects/`

### Excluding Projects

Create `~/.config/episodic-memory/exclude-projects.txt`:

```
private-client-work
personal-journal
temp-experiments
```

Or set environment variable:

```bash
export CONVERSATION_SEARCH_EXCLUDE_PROJECTS="project1,project2"
```

## Architecture

- **Parser** (`src/parser.ts`) - Reads `.jsonl` conversation files
- **Indexer** (`src/indexer.ts`) - Coordinates parsing, embedding, and storage
- **Embeddings** (`src/embeddings.ts`) - Generates vector embeddings
- **Summarizer** (`src/summarizer.ts`) - Creates AI summaries
- **Database** (`src/db.ts`) - SQLite with vector extension
- **Search** (`src/search.ts`) - Vector and text search implementation
- **Show** (`src/show.ts`) - Conversation display formatting

## Requirements

- Node.js 18+
- Claude API key (for summarization)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run test:watch
```

## License

MIT - See LICENSE file

## Author

Jesse Vincent <jesse@fsck.com>
