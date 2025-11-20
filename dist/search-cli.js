import { searchConversations, formatResults, searchMultipleConcepts, formatMultiConceptResults } from './search.js';
const args = process.argv.slice(2);
// Parse arguments
let mode = 'both';
let after;
let before;
let limit = 10;
const queries = [];
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
        console.log(`
Usage: episodic-memory search [OPTIONS] <query>

Search indexed conversations using semantic similarity or exact text matching.

MODES:
  (default)      Combined vector + text search
  --vector       Vector similarity only (semantic)
  --text         Exact string matching only (for git SHAs, error codes)

OPTIONS:
  --after DATE   Only conversations after YYYY-MM-DD
  --before DATE  Only conversations before YYYY-MM-DD
  --limit N      Max results (default: 10)
  --help, -h     Show this help

EXAMPLES:
  # Semantic search
  episodic-memory search "React Router authentication errors"

  # Find exact string
  episodic-memory search --text "a1b2c3d4e5f6"

  # Time filtering
  episodic-memory search --after 2025-09-01 "refactoring"

  # Combine modes
  episodic-memory search --both "React Router data loading"

  # Multi-concept search (AND - all concepts must match)
  episodic-memory search "React Router" "authentication" "JWT"
`);
        process.exit(0);
    }
    else if (arg === '--vector') {
        mode = 'vector';
    }
    else if (arg === '--text') {
        mode = 'text';
    }
    else if (arg === '--after') {
        after = args[++i];
    }
    else if (arg === '--before') {
        before = args[++i];
    }
    else if (arg === '--limit') {
        limit = parseInt(args[++i]);
    }
    else {
        // All non-flag args are query terms
        queries.push(arg);
    }
}
if (queries.length === 0) {
    console.error('Usage: episodic-memory search [OPTIONS] <query> [query2] [query3]...');
    console.error('Try: episodic-memory search --help');
    process.exit(1);
}
// Multi-concept search if multiple queries provided
if (queries.length > 1) {
    const options = { limit, after, before };
    searchMultipleConcepts(queries, options)
        .then(async (results) => {
        console.log(await formatMultiConceptResults(results, queries));
    })
        .catch(error => {
        console.error('Error searching:', error);
        process.exit(1);
    });
}
else {
    // Single query - use regular search
    const options = {
        mode,
        limit,
        after,
        before
    };
    searchConversations(queries[0], options)
        .then(async (results) => {
        console.log(await formatResults(results));
    })
        .catch(error => {
        console.error('Error searching:', error);
        process.exit(1);
    });
}
