---
name: Remembering Conversations
description: Use ANY TIME starting work on bugs, features, architecture, or debugging. Use ANY TIME before suggesting solutions - you have no memory between sessions and will reinvent solutions or repeat past mistakes without searching first. Search past conversations for authentication issues, API patterns, testing approaches, build problems, deployment configs, error messages, framework usage, or ANY technical decision. Use when user references prior work or when beginning ANY non-trivial task.
---

# Remembering Conversations

**Core principle:** Search before reinventing. Searching costs nothing; reinventing or repeating mistakes costs everything.

## Mandatory: Use the Search Agent

**YOU MUST dispatch the search-conversations agent for any historical search.**

Announce: "Dispatching search agent to find [topic]."

Then use the Task tool with `subagent_type: "search-conversations"`:

```
Task tool:
  description: "Search past conversations for [topic]"
  prompt: "Search for [specific query or topic]. Focus on [what you're looking for - e.g., decisions, patterns, gotchas, code examples]."
  subagent_type: "search-conversations"
```

The agent will:
1. Search with the `search` tool
2. Read top 2-5 results with the `show` tool
3. Synthesize findings (200-1000 words)
4. Return actionable insights + sources

**Saves 50-100x context vs. loading raw conversations.**

## When to Use

Search proactively:
- Before implementing features
- Before making architectural decisions
- When debugging (especially familiar-seeming issues)
- When partner mentions past work
- At the start of ANY non-trivial task

Don't search:
- For info in current conversation
- For current codebase structure (use Grep/Read)

## Direct Tool Access (Discouraged)

You CAN use MCP tools directly, but DON'T:
- `mcp__plugin_episodic-memory_episodic-memory__search`
- `mcp__plugin_episodic-memory_episodic-memory__show`

Using these directly wastes your context window. Always dispatch the agent instead.

See MCP-TOOLS.md for complete API reference if needed for advanced usage.
