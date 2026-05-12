# Codex Support

Episodic Memory supports Codex as a native plugin starting with `codex-cli 0.130.0`.

That version is the support floor because this plugin depends on all of these Codex surfaces:

- plugin manifests and plugin MCP loading
- plugin lifecycle hooks
- hook trust state in `hooks.state`
- app-server `thread/fork` with `ephemeral: true` for Codex-native summarization
- Codex rollout JSONL transcripts in `$CODEX_HOME/sessions`

## Install and Enable

Install the plugin through the normal Codex plugin workflow or a marketplace entry. For local development, use a real copied plugin directory; Codex's plugin loader does not follow symlinked cache directories.

Enable plugin hooks:

```bash
codex features enable plugin_hooks
```

Start Codex and open the hook manager:

```text
/hooks
```

Review the Episodic Memory `SessionStart` hook and press `t` to trust it. New or modified unmanaged hooks do not run until trusted. After the hook is trusted, Enter or Space can toggle it enabled or disabled.

Codex stores hook trust like this in `$CODEX_HOME/config.toml`:

```toml
[hooks.state."episodic-memory@test:hooks/hooks.json:session_start:0:0"]
trusted_hash = "sha256:..."
```

If the plugin changes the hook command or normalized hook config, Codex marks the hook modified and requires review again.

## Verify

Run:

```bash
episodic-memory doctor codex
```

The doctor checks:

- Codex version is at least `0.130.0`
- `$CODEX_HOME/sessions` exists
- `plugins` and `plugin_hooks` are enabled
- `codex mcp list` shows `episodic-memory` enabled
- the memory database and hook/background sync log paths

Hook and background sync output is written to:

```text
$EPISODIC_MEMORY_CONFIG_DIR/logs/episodic-memory.log
```

or, by default:

```text
~/.config/superpowers/logs/episodic-memory.log
```

## End-to-End Test

The real Codex E2E test is opt-in because it starts live Codex sessions and uses the configured model/account.

```bash
npm run build
EPISODIC_MEMORY_RUN_CODEX_E2E=1 npm run test:codex-e2e
```

The test creates an isolated temporary `CODEX_HOME`, copies your existing Codex auth file into it, copies the plugin into Codex's plugin cache shape, enables and trusts the plugin hook, starts Codex sessions inside `tmux`, and verifies:

- sessions are archived
- summaries are generated
- the SQLite index is created
- a later Codex session uses the Episodic Memory MCP search tool and finds the earlier marker

## Summaries

Codex summaries use `codex app-server`, `thread/fork`, and `ephemeral: true`. This matters: `codex exec --ephemeral resume <session>` was tested and still appended to the resumed rollout, so it is not the quality bar for summarization.

If the Codex app-server summarizer is unavailable or below the support floor, Episodic Memory logs the reason and falls back to transcript-text summarization instead of silently skipping the conversation.
