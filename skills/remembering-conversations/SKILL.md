---
name: Remembering Conversations
description: Search previous Claude Code conversations for past decisions, patterns, solutions, and context. Search proactively at the start of any non-trivial task - historical context consistently improves decision-making, prevents reinventing solutions, and avoids repeating past mistakes.
---

# Remembering Conversations

**Core principle:** Search before reinventing. Searching costs nothing; reinventing or repeating mistakes costs everything.

**Always announce:** "Searching previous conversations for [topic]."

## When to Use

Search proactively:
- Before implementing features
- Before making architectural decisions
- When debugging (especially familiar-seeming issues)
- When partner mentions past work

Don't search:
- For info in current conversation
- For current codebase structure (use Grep/Read)

## Quick Reference

| Task | Tool | Parameters |
|------|------|------------|
| Semantic search | `search` | `query`, `limit: 10` |
| Exact match | `search` | `query`, `mode: "text"` |
| Read conversation | `read` | `path` from search results |

Full tool names:
- `mcp__plugin_episodic-memory_episodic-memory__search`
- `mcp__plugin_episodic-memory_episodic-memory__read`

## How to Search

**Use `/search-conversations` slash command** - dispatches agent that:
1. Searches with `search` tool
2. Reads top results with `read` tool
3. Synthesizes findings (200-1000 words)
4. Returns actionable insights + sources

Saves 50-100x context vs. loading raw conversations.

See MCP-TOOLS.md for complete API reference.
