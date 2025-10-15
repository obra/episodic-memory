---
name: search-conversations
description: Search previous Claude Code conversations using semantic or text search
---

# Search Past Conversations

I'm going to search your previous Claude Code conversations to find relevant context.

What are you looking for? Describe it in natural language:
- "How did we handle authentication in React Router?"
- "The conversation about async testing patterns"
- "Error message about sqlite-vec initialization"
- "Git commit SHA for the routing refactor"

**Search modes:**
- **Semantic** (default) - Finds conceptually similar discussions
- **Text** - Exact string matching for SHAs, error codes
- **Both** - Combines semantic + exact matching

**Filters available:**
- Date range (--after, --before)
- Result limit (default: 10)

I'll dispatch a search agent to:
1. Search the conversation archive
2. Read the most relevant results
3. Synthesize key findings
4. Provide source pointers for deeper investigation

This saves 50-100x context compared to loading raw conversations directly.
