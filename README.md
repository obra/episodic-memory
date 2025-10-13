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
# Index conversations
episodic-memory-index

# Search conversations
episodic-memory-search "React Router authentication"
episodic-memory-search --text "exact phrase"
episodic-memory-search --after 2025-09-01 "refactoring"
```

### In Claude Code

The plugin automatically indexes conversations at session end. Use the search command:

```
/search-conversations
```

Or reference past work in natural conversation - Claude will search when appropriate.

## Architecture

- **Core package** - TypeScript library for indexing and searching conversations
- **CLI tools** - Command-line interface for manual use
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
