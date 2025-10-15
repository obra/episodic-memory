import { searchConversations, formatResults, SearchOptions } from './search.js';

const args = process.argv.slice(2);

// Parse arguments
let mode: 'vector' | 'text' | 'both' = 'both';
let after: string | undefined;
let before: string | undefined;
let limit = 10;
let query: string | null = null;

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
`);
    process.exit(0);
  } else if (arg === '--vector') {
    mode = 'vector';
  } else if (arg === '--text') {
    mode = 'text';
  } else if (arg === '--after') {
    after = args[++i];
  } else if (arg === '--before') {
    before = args[++i];
  } else if (arg === '--limit') {
    limit = parseInt(args[++i]);
  } else if (!query) {
    query = arg;
  }
}

if (!query) {
  console.error('Usage: episodic-memory search [OPTIONS] <query>');
  console.error('Try: episodic-memory search --help');
  process.exit(1);
}

const options: SearchOptions = {
  mode,
  limit,
  after,
  before
};

searchConversations(query, options)
  .then(results => {
    console.log(formatResults(results));
  })
  .catch(error => {
    console.error('Error searching:', error);
    process.exit(1);
  });
