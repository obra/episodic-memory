#!/bin/bash
# Wrapper for SessionStart hook that resolves plugin root dynamically
# Mirrors the fallback pattern used in cli/mcp-server-wrapper.js

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Plugin root is one level up from hooks/
PLUGIN_ROOT="$SCRIPT_DIR/.."

# Run the sync command
"$PLUGIN_ROOT/cli/episodic-memory" sync
