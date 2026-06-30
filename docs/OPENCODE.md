# OpenCode Support

Episodic Memory supports opencode by exporting sessions from opencode's SQLite
database into generated JSONL transcripts, then indexing those transcripts with
the same archive and search pipeline used for Claude Code and Codex.

## Install

Install the package globally or make it available to opencode:

```bash
npm install -g github:obra/episodic-memory
```

Then add the server plugin to your opencode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["episodic-memory"]
}
```

The package exposes an opencode server plugin at `episodic-memory/server`.
opencode discovers that entrypoint automatically from package metadata when the
package is listed in `plugin`.

## Sync

The plugin runs this command in the background when an opencode session becomes
idle:

```bash
episodic-memory sync --background --only opencode --summary-limit 10
```

Manual sync works the same way:

```bash
episodic-memory sync --only opencode
```

By default, episodic-memory reads:

```text
~/.local/share/opencode/opencode.db
```

Override the database path when needed:

```bash
export EPISODIC_MEMORY_OPENCODE_DB_PATH=/path/to/opencode.db
```

Generated transcripts are written under:

```text
~/.config/superpowers/opencode-transcripts
```

Override that directory with:

```bash
export EPISODIC_MEMORY_OPENCODE_TRANSCRIPT_DIR=/path/to/generated-transcripts
```

## Doctor

Check the local opencode integration with:

```bash
episodic-memory doctor opencode
```

The doctor verifies the opencode version, package plugin configuration, MCP
registration, SQLite database path, generated transcript directory, and
background sync log path.

## MCP

Use the existing MCP server with opencode so agents can search indexed memory:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "episodic-memory": {
      "type": "local",
      "command": ["episodic-memory-mcp-server"],
      "enabled": true
    }
  }
}
```
