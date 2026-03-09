---
name: remembering-conversations
description: Retrieves and synthesizes relevant context from past conversations to surface prior decisions, patterns, and gotchas — returning actionable insights without consuming large amounts of context. Use when user asks 'how should I approach this codebase decision...' or 'what's the best architecture/pattern for...', when stuck on a complex problem with no obvious solution in current code, when following an unfamiliar workflow, or when user references past work with phrases like 'last time', 'we discussed', 'you implemented', or 'do you remember'.
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

The agent searches with the `search` tool, reads top 2-5 results with the `show` tool, and returns a 200–1000 word synthesis of actionable insights and sources — **saving 50–100× context vs. loading raw conversations.**

## When to Use

Search memory once you understand what you're being asked:

**After understanding the task:**
- User asks "how should I..." or "what's the best approach..." for an architectural or implementation decision
- You've explored the current codebase and need to make design choices
- User asks for an implementation approach after describing what they want

**When you're stuck:**
- You've investigated a problem and can't find the solution
- Facing a complex problem without an obvious solution in current code
- Need to follow an unfamiliar workflow or process

**When historical signals are present:**
- User says "last time", "before", "we discussed", "you implemented"
- User asks "why did we...", "what was the reason..."
- User says "do you remember...", "what do we know about..."

**Don't search first:**
- For current codebase structure (use Grep/Read to explore first)
- For info already in the current conversation
- Before understanding what you're being asked to do

## Handling Insufficient Results

If the search returns nothing useful or too little context:
- **Try broader terms:** swap specific identifiers for general concepts (e.g., "authentication" instead of "JWT refresh token handler")
- **Try alternative phrasings:** rephrase the query around the problem domain rather than the solution
- **Try a second search:** dispatch the agent again with the refined query before giving up
- **If still empty:** inform the user that no prior context exists on this topic and proceed without it

## Direct Tool Access (Discouraged)

You CAN use MCP tools directly — `mcp__plugin_episodic-memory_episodic-memory__search` and `mcp__plugin_episodic-memory_episodic-memory__show` — but doing so wastes your context window. Always dispatch the agent instead. See MCP-TOOLS.md for the complete API reference.
