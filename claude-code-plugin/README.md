# Episodic Memory - Claude Code Plugin

Search previous Claude Code conversations using semantic similarity or exact text matching.

## Features

- **Automatic Indexing** - Conversations indexed at session end
- **Semantic Search** - Find conceptually similar discussions
- **Exact Text Search** - Locate git SHAs, error messages, specific phrases
- **Slash Command** - `/search-conversations` for quick access

## Installation

```bash
# Via marketplace (recommended)
/plugin marketplace add obra/superpowers-marketplace
/plugin install episodic-memory@superpowers-marketplace

# Or directly
/plugin install obra/episodic-memory
```

## Usage

### In Sessions

Use natural language - Claude will search when it detects you're referencing past work:

```
"How did we handle authentication last time?"
"Find the conversation about React Router data loading"
```

### Slash Command

```
/search-conversations
```

Then describe what you're looking for.

### Manual Search

The plugin installs CLI tools you can use outside Claude Code:

```bash
episodic-memory-search "React Router authentication"
episodic-memory-search --text "a1b2c3d"
episodic-memory-search --after 2025-09-01 "refactoring"
```

## How It Works

1. **SessionEnd Hook** - Auto-indexes each conversation after it ends
2. **Vector Embeddings** - Uses Transformers.js to generate semantic embeddings
3. **SQLite + sqlite-vec** - Fast vector similarity search
4. **AI Summaries** - Claude summarizes each conversation for better search results

## Commands

- `/search-conversations` - Search past conversations

## Indexing

Initial setup (if you have existing conversations):

```bash
episodic-memory-index --cleanup
```

After that, indexing happens automatically via the SessionEnd hook.

## Configuration

The database lives at `~/.config/episodic-memory/conversations.db`

Conversation logs are read from Claude Code's default location.

## License

MIT
