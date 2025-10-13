#!/usr/bin/env bash
# SessionEnd hook for episodic-memory plugin
# Automatically indexes conversations after each session

set -euo pipefail

# Get the session ID from CLAUDE environment variable
SESSION_ID="${CLAUDE_SESSION_ID:-}"

if [ -z "$SESSION_ID" ]; then
  echo "Warning: No session ID found, skipping conversation indexing"
  exit 0
fi

# Index the conversation in the background
# Use the episodic-memory CLI installed via npm
episodic-memory-index --session "$SESSION_ID" > /dev/null 2>&1 &

exit 0
