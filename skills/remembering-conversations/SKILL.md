---
name: remembering-conversations
description: Use when user asks 'how should I...' or 'what's the best approach...' after exploring code, OR when you've tried to solve something and are stuck, OR for unfamiliar workflows, OR when user references past work. Searches conversation history.
---

# Remembering Conversations

**Core principle:** Search before reinventing. Searching costs nothing; reinventing or repeating mistakes costs everything.

## Mandatory: Search Historical Memory

**YOU MUST search historical memory for any historical search.**

Announce: "Searching past conversations for [topic]."

### Claude Code

Use the Task tool with `subagent_type: "search-conversations"`:

```
Task tool:
  description: "Search past conversations for [topic]"
  prompt: "Search for [specific query or topic]. Focus on [what you're looking for - e.g., decisions, patterns, gotchas, code examples]."
  subagent_type: "search-conversations"
```

### Codex

If a `search-conversations` agent is available, dispatch it with the same prompt. If not, use the MCP tools directly:

1. Search with the episodic-memory `search` tool
2. Read the top 2-5 results with the episodic-memory `read` tool
3. Synthesize findings in your response
4. Include source pointers so the user can inspect the original conversations

The search workflow will:
1. Search with the `search` tool
2. Read top 2-5 results with the `read` tool
3. Synthesize findings (200-1000 words)
4. Return actionable insights + sources

**Saves 50-100x context vs. loading raw conversations.**

## When to Use

You often get value out of consulting your episodic memory once you understand what you're being asked. Search memory in these situations:

**After understanding the task:**
- User asks "how should I..." or "what's the best approach..."
- You've explored current codebase and need to make architectural decisions
- User asks for implementation approach after describing what they want

**When you're stuck:**
- You've investigated a problem and can't find the solution
- Facing a complex problem without obvious solution in current code
- Need to follow an unfamiliar workflow or process

**When historical signals are present:**
- User says "last time", "before", "we discussed", "you implemented"
- User asks "why did we...", "what was the reason..."
- User says "do you remember...", "what do we know about..."

**Don't search first:**
- For current codebase structure (use Grep/Read to explore first)
- For info in current conversation
- Before understanding what you're being asked to do

## Direct MCP Tool Access

Use these directly when a search agent is unavailable or the current harness does not support agent dispatch:
- `mcp__plugin_episodic-memory_episodic-memory__search`
- `mcp__plugin_episodic-memory_episodic-memory__read`

When using MCP tools directly, keep context small: search first, then read only the top 2-5 relevant conversations or line ranges.

See MCP-TOOLS.md for complete API reference if needed for advanced usage.
