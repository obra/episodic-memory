# Episodic Memory

Semantic search for Claude Code conversations. Remember past discussions, decisions, and patterns.

## Installation

### As an npm package

```bash
npm install episodic-memory
```

### As a Claude Code plugin

```bash
# In Claude Code
/plugin install episodic-memory@superpowers-marketplace
```

## Usage

### Command Line

```bash
# Unified command interface
episodic-memory <command> [options]

# Index conversations
episodic-memory index --cleanup

# Search conversations
episodic-memory search "React Router authentication"
episodic-memory search --text "exact phrase"
episodic-memory search --after 2025-09-01 "refactoring"

# Display a conversation in readable format
episodic-memory show path/to/conversation.jsonl
episodic-memory show --format html conversation.jsonl > output.html
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

### `episodic-memory index`

Index and manage conversation archives. See `episodic-memory index --help` for full options.

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
- **Claude Code plugin** - Integration with Claude Code (auto-indexing, slash commands)

## How It Works

1. Parses Claude Code conversation logs (JSONL format)
2. Generates embeddings using Transformers.js
3. Stores in SQLite with sqlite-vec for vector search
4. Supports both semantic similarity and exact text matching

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
