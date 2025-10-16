---
name: search-conversations
description: Search previous Claude Code conversations using semantic or text search
---

# Search Past Conversations

**Core principle:** Search before reinventing.

## When to Use

**Search when:**
- Your human partner mentions "we discussed this before"
- Debugging similar issues
- Looking for architectural decisions or patterns
- Before implementing something familiar

**Don't search when:**
- Info is in current conversation
- Question is about current codebase (use Grep/Read instead)

## How It Works

I'll dispatch a search agent to:
1. Search the conversation archive using the `search` tool
2. Read the top 2-5 most relevant results with the `read` tool
3. Synthesize key findings (200-1000 words)
4. Provide source pointers for deeper investigation

This saves 50-100x context compared to loading raw conversations directly.

## What I Need From You

Describe what you're looking for in natural language:
- "How did we handle authentication in React Router?"
- "The conversation about async testing patterns"
- "Error message about sqlite-vec initialization"
- "Git commit SHA for the routing refactor"

## Search Modes

- **Semantic** (default) - Finds conceptually similar discussions
- **Text** - Exact string matching for SHAs, error codes
- **Both** - Combines semantic + exact matching

**Filters available:**
- Date range (--after, --before)
- Result limit (default: 10)
