# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-09-08

Adds a fifth conversation source, an off switch for automatic syncing, and two fixes for real-world resource problems.

### Added

- Oh My Pi (OMP) conversations are now indexed and searchable, alongside Claude Code, Codex, Cursor, and opencode. Sessions in `~/.omp/agent/sessions` are picked up automatically; the parser follows the active branch of a session's message tree. Built to the format reported in the issue — if your OMP transcripts index oddly, please open an issue. Thanks to @rhlsthrm for the request and format details (#148).
- `EPISODIC_MEMORY_DISABLE_AUTO_SYNC=1` fully turns off the automatic background sync that runs on session start, for anyone who prefers to sync on a schedule (cron or a scheduled task) or pause indexing entirely. Unlike `EPISODIC_MEMORY_SKIP_SUMMARIES`, this stops the copy and index work too. A manual `sync` you run yourself is unaffected. Thanks to @Nogalj (#163).
- AWS Bedrock is a supported summarization backend. Set `CLAUDE_CODE_USE_BEDROCK=1` with your AWS credentials and region in the plugin's environment and summaries route through Bedrock; the metered-billing warning correctly stays quiet since no `ANTHROPIC_API_KEY` is involved. The credential passthrough is tested; the live Bedrock call depends on your AWS setup. Thanks to @daniel-butler (#44).

### Fixed

- Syncing no longer re-embeds work it has already indexed. The background sync had its own indexing loop that re-embedded every message of every file it copied, on every run — so a long-lived session's transcript was re-processed in full each time, and the cost grew with the file. It now embeds only new messages, matching the incremental indexer. On large corpora this turns minutes of repeated work per sync into seconds. Thanks to @dkindlund (#152).
- A `DO NOT INDEX` marker is now honored even in very large transcripts. Files above the ~512 MB string limit were scanned only partially and, on the error path, indexed anyway — so the marker could be silently missed. The check now fails closed: if a large file can't be fully verified as marked, it is not indexed. Thanks to @dkindlund (#152).
- Foreign summarizer payloads can no longer bloat the index. Some third-party tools embed an entire conversation transcript into a single prompt, which was then stored as one multi-megabyte "message" — in one report, 97% of a 3 GB index. Messages above a size cap (256 KB by default, `EPISODIC_MEMORY_MAX_MESSAGE_BYTES` to change) are now skipped before embedding, with a count logged per run. Normal turns are thousands of times smaller and are unaffected. Thanks to @danielsimonjr (#139).
- Failed dependency installs no longer pile up. When the MCP server wrapper had to run `npm install` and the connection timed out, the install child was orphaned and kept running, and each retry started another — several could end up competing and starving each other so none finished. The wrapper now kills its install child when it exits and holds a single-install lock so retries can't stack. Thanks to @chernobylx (#161).

## [1.5.0] - 2026-09-08

This release closes a summarizer security hole, adds two new coding tools to what you can search, makes search itself return the results it used to miss, and hardens install and summarization against a long list of real-world failures.

### Security

- The background summarizer can no longer act inside your live session. It used to resume the session with your tools, your MCP servers, and your settings all loaded, so a summarize pass could execute pending work and, in at least one report, commit to a working repo. It now runs with no tools, no user MCP servers, and no user settings — it can only write a summary. If you saw a background agent modify files, launch extra MCP windows per conversation, or fire "task finished" notifications for old sessions, that is fixed (#108, #149, #106, #136).

### Added

- Search now covers Cursor conversations. Live Cursor transcripts are indexed automatically, and a one-time `import-cursor-history` command backfills your existing history from Cursor's local database (#113).
- Search now covers opencode conversations, including AI summaries for them (#117).
- Work done inside subagents and `Workflow` runs is searchable at last. These "sidechain" conversations were indexed but hidden from every search — in orchestration-heavy sessions that was most of the content. They now appear in results, ranked just below equally-relevant main-thread matches. Pass `include_sidechains: false` (or `--exclude-sidechains`) to restore the old main-thread-only behavior (#128).
- Three new environment switches: `EPISODIC_MEMORY_SKIP_SUMMARIES=1` turns off the summarization pass while still indexing (#159); `EPISODIC_MEMORY_SUMMARY_TIMEOUT_MS` caps how long one summary may run before it is abandoned (#160); `EPISODIC_MEMORY_ALLOW_METERED_API=1` acknowledges and silences the new metered-billing warning below (#104).

### Changed

- Sidechain conversations now surface in search by default (see Added). If you prefer the previous behavior, opt out per query.

### Fixed

- Multi-word text searches return results again. A `text`-mode query used to match only as one exact contiguous string, so almost any multi-word search came back empty. It now matches when every word appears, in any order (#144, #127).
- Date-filtered searches no longer come back empty. A search narrowed with `after`/`before` in vector mode could return nothing even when matches existed, because the date filter was applied after the nearest-neighbor cutoff. It now over-fetches so the date window is honored (#126).
- Summarization is far more robust. It now recovers instead of failing permanently when a conversation's original project is gone (#122), when the resume subprocess exits nonzero (#147), or when a conversation ends on an extended-thinking turn (#110); it reports the real error text and stops a whole batch fast on an expired login instead of burning ~32 minutes on doomed calls (#145, #138); and a single wedged summary can no longer stall every later sync, thanks to a timeout (#160).
- The summarizer warns before spending real money. If a global `ANTHROPIC_API_KEY` is set, background summaries bill the metered API instead of your Claude subscription; it now prints a one-time warning so the cost is visible. Set `EPISODIC_MEMORY_ALLOW_METERED_API=1` to acknowledge it (#104).
- Install fails loudly and clearly when the native database binding cannot load, instead of exiting clean and then crashing on first use with a confusing error (#150, #100).
- A host that cannot load the embedding backend no longer crashes at session start. Copying and summarization keep working; only semantic indexing is skipped, with a clear message (#135, #137).
- A single dangling symlink in your projects folder no longer crashes sync, index, verify, and rebuild (#142).
- A transcript that disappears mid-run no longer aborts the whole index; the run skips it and continues (#121).
- On Apple Silicon, embedding no longer pegs every CPU core during indexing; thread use is capped, with an env override, and no effect on other platforms (#124).
- Displayed conversation timestamps are pinned to a fixed format, so they no longer show a day-shifted or reordered date on non-US locales (#120, #130).
- Concurrent workers are safer: the index command now shares the single-instance lock with background sync, and a busy-timeout absorbs brief write overlaps (#156, #101).
- The bundled search agent's description was invalid YAML; it is now valid (#153).
- The test suite no longer writes into your real configuration directory (#119).

### Internal

- Continuous integration builds and tests every pull request, including from forks, on Node 22 and 24 (#164). Added isolated MCP server integration tests (#157). The committed build output is now regenerated reproducibly from source.

## [1.4.2] - 2026-05-21

### Fixed
- Summarization no longer crashes for conversations archived from a different project than the one running sync. Before, every short (≤15 exchange) conversation whose recorded project cwd differed from sync's cwd would silently fail with `Cannot read properties of undefined (reading 'match')`, and the failed file would re-queue forever. The summarizer now passes the recorded cwd through to the Claude Agent SDK and falls back to a non-resume summary when the project directory no longer exists on disk. Multi-project users were the most affected. Thanks to @minyek for the fix (#93).
- Codex summarization works again for ChatGPT-subscription users. The summarizer used to forward whatever model id was baked into the historical exchange data, including pre-deprecation values like `gpt-5.2-codex`. Codex's `app-server` returns a 400 for any `-codex` suffix variant when authenticating via a ChatGPT account, so older Codex sessions silently fell through to the transcript-text fallback (hurting recall quality). The summarizer now lets Codex pick the default from `~/.codex/config.toml#model`. Operators who need a specific model id can set `EPISODIC_MEMORY_CODEX_MODEL`. Thanks to @monsterxz9 for the fix (#99).
- Failed summaries no longer pin the head of the sync queue forever. Any transient summarization error (network blip, API rate limit, SDK shape change) used to leave no sentinel on disk, so the same file would re-attempt on every sync run indefinitely. Ten persistent failures at the head of the queue would block every conversation behind them from being summarized. Sync now writes a structured error sentinel and re-attempts after a configurable threshold (default 1 hour, via `EPISODIC_MEMORY_SUMMARY_ERROR_RETRY_HOURS`); verify, stats, and the indexer all distinguish real summaries from error sentinels (#96).
- Concurrent sync workers no longer race when multiple Claude Code sessions fire SessionStart at the same time. Multi-worktree setups previously spawned one background sync process per session, each trying to write to the same SQLite database (which crashes with `SQLITE_BUSY` on macOS/Linux) and each spawning Claude subprocesses (which exhausts the desktop heap on Windows, crashing workers with `STATUS_DLL_INIT_FAILED`). A single-instance file lock now serializes sync workers; competing workers print `sync already running (pid X); skipping` and exit cleanly (#97).
- The MCP server wrapper detects partial `node_modules` extractions. An interrupted plugin install could leave a package as just an empty folder (no manifest, no library code), and the previous wrapper declared deps healthy because `node_modules/` itself existed. First launch then crashed with a confusing `ERR_MODULE_NOT_FOUND`. The wrapper now probes each required package's manifest and reruns `npm install` if any are missing, logging which ones (#95 Bug 1).
- `npm install` exits 0 on Windows. The postinstall step previously used unix-only shell syntax (`2>/dev/null || true`) that fails on cmd.exe, so `npm install` exited non-zero even when every package installed correctly. Now uses a cross-platform Node script. The reporter on #95 saw this and started troubleshooting what they assumed was a broken install — those follow-on diagnostics led to the misidentified Bug 2 (`onnxruntime-common`-not-hoisted), which on reproduction turns out to be a misread of `npm ls`'s logical-tree output (the package is hoisted in practice).

## [1.4.1] - 2026-05-17

### Fixed
- Sync no longer gets stuck on conversations with no real content. Previously, files with only metadata or stub records re-queued for summarization on every run. Once ten of them piled up at the head of the queue, real conversations behind them stopped getting summarized at all. Now those files are marked as done the first time they're skipped, and the backlog drains. Thanks to @minyek for the fix.

## [1.4.0] - 2026-05-13

### Changed
- The `remembering-conversations` skill now triggers reliably for personal-fact lookups and other small questions that previously slipped past it. Tested against fresh sessions asking a personal-fact question, the previous description fired the skill 0/5 trials; the new description fires 3/5.

### Removed
- The `/search-conversations` slash command. Reference past work in natural conversation instead — the `remembering-conversations` skill dispatches the `search-conversations` agent automatically when recall is needed.

## [1.3.1] - 2026-05-13

### Fixed
- Recall skills now trigger when an agent needs to remember anything learned from prior Claude Code or Codex conversations, including decisions, patterns, solutions, pitfalls, workflows, project context, and lessons from similar work.
- Search-agent and slash-command descriptions now describe broad recall situations instead of narrowing discovery to explicit user requests or personal facts.

## [1.3.0] - 2026-05-13

### Added
- Native Codex plugin support with `.codex-plugin/plugin.json`, Codex MCP configuration, plugin hook packaging, and a local development marketplace entry.
- Codex rollout transcript parsing, display, archiving, indexing, and cross-harness search across Claude Code and Codex conversations.
- Codex-native summarization through `codex app-server` ephemeral `thread/fork`, with transcript-text fallback when Codex summarization is unavailable.
- `episodic-memory doctor codex` for checking Codex version, plugin features, MCP registration, hook trust, transcript directory, database, and sync log paths.
- Opt-in live Codex and Claude E2E scripts that verify archive, summary, index, and MCP recall behavior.

### Changed
- Recall skill instructions and MCP tool documentation now describe Claude Code and Codex usage, including direct MCP search/read guidance in Codex.
- CLI help, README setup, and architecture documentation now describe Claude Code plus Codex support.

### Fixed
- Codex hook trust diagnostics now report when the Episodic Memory hook is already trusted instead of always suggesting `/hooks`.
- Codex HTML transcript rendering now escapes raw HTML from transcript content before rendering.
- Codex `local_shell_call_output` items are now paired with local shell tool calls during parsing and included in rendered transcript output.

## [1.2.0] - 2026-05-03

### Better search results

This release upgrades the embedding model used for semantic search. On a 17,000-exchange retrieval test built from real production data, the new model puts the right answer at rank 1 about **53% of the time, up from 47%**. Top-10 accuracy improves from 68% to 75%.

The new model is `bge-small-en-v1.5` (BAAI), replacing `all-MiniLM-L6-v2`. Both produce 384-dimensional embeddings, so storage is unchanged.

### Automatic migration

Existing indexes upgrade themselves in the background. After you install 1.2.0, each `episodic-memory sync` re-embeds up to 500 stored exchanges with the new model. Claude Code triggers a sync at every session start, so most indexes finish migrating after roughly 60 sync runs — a few days of normal use.

During sync you'll see a line like this on stderr:

    episodic-memory: re-embedding batch of 500 (29569 stale total)...

Search keeps working throughout. The index holds a mix of old and new embeddings until migration finishes; ranking is slightly noisier but never broken.

To finish faster, run a sync with a larger batch:

    EPISODIC_MEMORY_MIGRATION_BATCH=5000 episodic-memory sync

That takes about a minute per call on a recent Mac.

If two syncs run at once, only one re-embeds; the other skips its migration step. A crash mid-batch leaves the unfinished rows tagged for migration, and the next sync picks up where the previous one stopped.

### Other notes

- **First sync after upgrade** downloads a new 34 MB model file.
- **Rollback to 1.1.x is safe.** Search still works against a partially-migrated index.
- **Resolves #82** (ONNX runtime crash on Node 23 and earlier) as a side effect of the underlying library upgrade.

## [1.1.2] - 2026-05-03

### Fixed
- **Critical: recursive process explosion from auto-sync** (#87, #88, thanks @kaankoken and @materemias for the diagnosis):
  - The `persistSession: false` fix in 1.1.0 (#83) prevented the SDK-spawned Claude subprocess from *saving* its session JSONL, but did not stop the subprocess from *firing the SessionStart hook*. That re-ran `episodic-memory sync --background`, which re-summarized, which spawned another Claude subprocess, which fired the hook again — fanning out hundreds of detached processes, saturating CPU, and burning API quota.
  - Added a reentrancy guard env var `EPISODIC_MEMORY_SUMMARIZER_GUARD`, set when calling the SDK's `query()` and inherited by the spawned subprocess. The `sync-cli` entry point checks the guard at startup and exits silently when it's set, breaking the recursive cascade at its only feasible point.
  - Coverage: unit tests for `getApiEnv()` (always sets the guard) and `shouldSkipReentrantSync()`, plus an integration test that spawns `dist/sync-cli.js` with the guard env and asserts a clean exit without doing work.
  - Anyone affected by the cascade should update to 1.1.2 immediately. If 1.1.0 or 1.1.1 had been spawning processes, kill any lingering `episodic-memory` and `claude-agent-sdk` children before restarting Claude Code.

## [1.1.1] - 2026-05-03

### Fixed
- **MCP server now reports the actual plugin version** in its protocol handshake instead of the long-stale hardcoded `1.0.0`. Inspector tools and any client logging the server identity will now see the real version.

### Changed
- **Single source of truth for version numbers.** `package.json` is the source; `src/version.ts` is generated from it at prebuild/pretest time and is referenced by `mcp-server.ts`. Source code can no longer drift from the declared package version.
- **Drift test for manifest files.** A new `test/version-consistency.test.ts` asserts `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` all agree. CI fails if anyone bumps one without the others.
- **`scripts/bump-version.sh` + `.version-bump.json`** for one-command version bumps with built-in audit (greps the repo for stale version strings in undeclared files). Run `./scripts/bump-version.sh X.Y.Z` to update all declared files; `--check` reports current state, `--audit` scans for stragglers.

## [1.1.0] - 2026-05-02

### Added
- **Search metadata filters** (#63, thanks @jwk2601 for the design): `--project`, `--session-id`, and `--git-branch` flags scope results by exact-match project name, session ID, or git branch. Available on the CLI and the MCP `search` tool. Filter values bind as positional SQL parameters; the existing `--after`/`--before` time filters were converted from string interpolation to bound parameters in the same change.
- **API configuration env vars for summarization** (#37, thanks @techjoec):
  - `EPISODIC_MEMORY_API_MODEL` — override the summarizer model (default: haiku)
  - `EPISODIC_MEMORY_API_MODEL_FALLBACK` — fallback model on errors (default: sonnet)
  - `EPISODIC_MEMORY_API_BASE_URL` — custom Anthropic endpoint
  - `EPISODIC_MEMORY_API_TOKEN` — auth token for custom endpoint
  - `EPISODIC_MEMORY_API_TIMEOUT_MS` — request timeout

### Changed
- **Bumped `@anthropic-ai/claude-agent-sdk` to 0.2.x** (transitively requires zod 4). Required for the `persistSession` option used by the #83 fix.
- **`tool_calls` schema now uses `ON DELETE CASCADE`** (#81). Fresh databases create the table with cascade; existing databases get a one-time migration that recreates `tool_calls` with cascade and drops any orphaned rows. The migration is idempotent and runs only when the schema lacks `ON DELETE CASCADE`.
- **`exclude.txt` matches nested directory names** (#80, thanks @rohitgehe05 for the diagnosis): adding `subagents` now also skips `<project>/<session>/subagents/agent-*.jsonl` instead of only matching top-level project directories.

### Fixed
- **Indexer skipped appended exchanges** (#84, thanks @jamster for the diagnosis and detection script): the `COUNT(*) > 0` skip was replaced with a `MAX(line_end)` high-water mark, so transcripts that grow after their first index pass now pick up their tail. Resumed sessions and SessionStart syncs that race the still-running session no longer silently lose the trailing content.
- **Search similarity scores were wrong** (#55, thanks @gmax111): `1 - row.distance` was treating L2 distance as cosine distance. For unit-normalized embeddings the correct conversion is `1 - d²/2`. Result ordering was already correct (the formula was monotonic in distance), so this is a display/aggregation correction, not a ranking change.
- **Summarizer session pollution** (#83, thanks @benseeley for the detailed reproduction): `persistSession: false` is now passed to the SDK, so summarization no longer creates fake session JSONLs in `~/.claude/projects/<cwd-slug>/`.
- **`deleteExchange` FK crash** (#81, thanks @rohitgehe05): `index --repair` no longer fails with `SQLITE_CONSTRAINT_FOREIGNKEY` on exchanges that have associated tool_calls.
- **Windows hook fails on home directories with spaces** (#75, thanks @phantomsecurityandfire and @officialasishkumar): the SessionStart hook command now quotes `${CLAUDE_PLUGIN_ROOT}`.
- **MCP install fails with `ETARGET` on stale npm cache** (#76, thanks @DarkbyteAT and @mvanhorn): removed `--prefer-offline` from the wrapper's `npm install` invocation.
- **MCP protocol corruption from embedding model output** (#48): the embedding model's stdout is now redirected to stderr.
- **Orphaned MCP processes** (#54): added SIGHUP handler and stdin-close detection to the wrapper.
- **`exclude.txt` ignored at sync time** (#38): now honored by sync and verify commands.
- **Bundled file-discovery and path fixes** (#42, #50, #57, #62, #68, #70, #72): sidechain filtering in search, SessionStart `clear` matcher, `CLAUDE_CONFIG_DIR` support, recursive subagent file discovery, support for both `~/.claude/projects` and `~/.claude/transcripts`, and explicit surfacing of summarization failures.

### Documentation
- Fix npm install instructions to use the GitHub source (#71).

## [1.0.15] - 2025-12-17

### Changed
- **Stop shipping package-lock.json**: Removed from git tracking so npm generates platform-appropriate lockfile on install
- **Remove file deletion from MCP wrapper**: No longer deletes package-lock.json on first run (unnecessary without shipped lockfile)

## [1.0.14] - 2025-12-16

### Fixed
- **Windows spawn ENOENT error**: Add `shell` option for npx commands on Windows (#36, thanks @andrewcchoi!)
  - On Windows, npx is a .cmd file requiring `shell: true` for spawn() to work
  - Applied fix to `cli/episodic-memory.js` and `cli/index-conversations.js`
  - Resolves plugin initialization failures and silent SessionStart hook failures on Windows
- **Agent conversations polluting search index**: Add exclusion marker to summarizer prompts (#15, thanks @one1zero1one!)
  - Summarizer agent conversations are now properly excluded from indexing
  - Extracted marker to shared constant (`SUMMARIZER_CONTEXT_MARKER`) for maintainability
- **Background sync silently failing**: CLI now uses compiled JS instead of tsx at runtime (#25 root cause, thanks @stromseth for identifying!)
  - `--background` flag on sync command now works correctly
  - Fixes SessionStart hook auto-sync that was silently failing
- **Directory auto-creation**: Config directories are now created automatically (inspired by #18, thanks @gingerbeardman!)
  - `getSuperpowersDir()`, `getArchiveDir()`, `getIndexDir()` now ensure directories exist
  - Prevents errors on fresh installs where directories don't exist yet

### Changed
- **CLI uses compiled JavaScript**: Remove tsx from runtime path
  - All CLI commands now route through `dist/*.js` instead of `npx tsx src/*.ts`
  - Faster startup, lighter runtime dependencies
  - tsx is now dev-only (for tests and development)
  - Obsoletes PR #25 (background sync fix) by fixing root cause
- **CLI architecture cleanup**: Replace bash scripts with Node.js wrappers
  - All CLI entry points (`episodic-memory`, `index-conversations`, `search-conversations`, `mcp-server`) are now Node.js scripts
  - Eliminates bash dependency entirely for full cross-platform support (Windows, NixOS, etc.)
  - SessionStart hook now calls `node cli/episodic-memory.js` directly
  - Added `search-conversations.js` to complete Node.js CLI coverage
  - Obsoletes PRs #29 (pnpm workspace), #11 (env bash), and #17 (shebang fix)

## [1.0.13] - 2025-11-22

### Fixed
- **MCP server startup error**: Fix "Invalid or unexpected token" error when starting MCP server
  - Changed plugin.json to use `cli/mcp-server-wrapper.js` instead of bash script `cli/mcp-server`
  - MCP server configuration was pointing to bash script which was being executed with `node` command
  - Wrapper script properly handles Node.js execution and runs bundled `dist/mcp-server.js`

## [1.0.12] - 2025-11-22

### Changed
- **Skill triggering behavior**: Improved episodic memory skill to trigger at appropriate times
  - Changed from "ALWAYS USE THIS SKILL WHEN STARTING ANY KIND OF WORK" to contextual triggers
  - Now triggers when user asks for approach/decision after exploring code
  - Now triggers when stuck on complex problems after investigating
  - Now triggers for unfamiliar workflows or explicit historical references
  - Prevents premature memory searches before understanding current codebase
  - Empirically tested with subagents: 5/5 scenarios passed vs 3/5 with previous description

## [1.0.11] - 2025-11-20

### Fixed
- **Plugin Configuration**: Fix duplicate hooks file error in Claude Code
  - Remove duplicate `"hooks": "./hooks/hooks.json"` reference from plugin.json
  - Claude Code automatically loads hooks/hooks.json, so manifest should only reference additional hook files
  - Update MCP server reference from obsolete `mcp-server-wrapper.js` to direct `mcp-server` script

### Changed
- Simplified plugin.json configuration for cleaner Claude Code integration

## [1.0.10] - 2025-11-20

### Fixed
- **Search result formatting**: Prevent Claude's Read tool 256KB limit failures
  - Search results now include file metadata (size in KB, total line count)
  - Changed from verbose 3-line format to clean 1-line: "Lines 10-25 in /path/file.jsonl (295.7KB, 1247 lines)"
  - Removes prescriptive MCP tool instructions, trusting Claude to choose correct tool based on file size
  - Eliminates issue where episodic memory search triggered built-in Read tool instead of specialized MCP read tool

### Changed
- Enhanced `formatResults()` and `formatMultiConceptResults()` with async file metadata collection
- Added efficient streaming line counting and file size utilities
- Updated MCP server and CLI callers to handle async formatting functions

## [1.0.9] - 2025-10-31

### Removed
- **Dead code cleanup**: Removed obsolete bash script `cli/mcp-server-wrapper`
  - Eliminates duplicate wrapper implementations
  - Only Node.js cross-platform wrapper `mcp-server-wrapper.js` remains
  - Prevents confusion about which wrapper to use
  - Cleaner codebase with single MCP server entry point

### Changed
- Simplified MCP server architecture with single wrapper implementation
- Improved maintainability by removing redundant bash script

## [1.0.8] - 2025-10-31

### Fixed
- **Issue #7**: Fixed Windows support for MCP server provided in plugin
  - Replaced bash script `mcp-server-wrapper` with cross-platform Node.js version
  - MCP server now works on Windows with Claude Code native install
  - Resolves "No such file or directory" errors on Windows when using `/bin/bash`

### Changed
- MCP server wrapper now uses `node cli/mcp-server-wrapper.js` instead of bash script
- Cross-platform dependency installation with proper Windows npm.cmd handling
- Improved signal forwarding and process management in wrapper

### Added
- Cross-platform Node.js wrapper script for MCP server initialization
- Better error handling and messaging for missing dependencies
- Windows-compatible npm command detection (`npm.cmd` vs `npm`)

## [1.0.7] - 2025-10-31

### Fixed
- **Issue #10**: Fixed SessionStart hook configuration that prevented memory sync from running
  - Removed invalid `args` property from hook configuration
  - Added `async: true` and `--background` flag to prevent blocking Claude startup
- **Issue #5**: Fixed summary generation failure during sync command
  - Resolved confusion between archived conversation IDs and active session IDs
  - Sync now properly generates summaries for archived conversations
- **Issue #9**: Fixed better-sqlite3 Node.js version compatibility issues
  - Added postinstall script to automatically rebuild native modules
  - Resolves NODE_MODULE_VERSION mismatch errors on Node.js v25+
- **Issue #8**: Fixed version mismatch between git tags and marketplace.json
  - Synchronized plugin version metadata with release tags

### Added
- Background sync mode with `--background` flag for non-blocking operation
- Automatic native module rebuilding for cross-Node.js version compatibility
- Enhanced CLI help documentation with background mode usage examples

### Changed
- SessionStart hook now uses `episodic-memory sync --background` for instant startup
- Sync command forks to background process when `--background` flag is used
- Improved hook configuration follows Claude Code hook specification exactly
- Updated marketplace.json versions in both embedded and superpowers-marketplace locations

### Security
- Fixed potential process blocking during Claude Code startup
- Improved process detachment for background operations

## [1.0.6] - 2025-10-27

### Fixed
- **Issue #1**: Fixed Windows CLI execution failure by replacing bash scripts with cross-platform Node.js implementation
- **Issue #4**: Fixed sqlite-vec extension loading error on macOS ARM64 and Linux by adding `--external:sqlite-vec` to esbuild configuration
- Resolved "Loadable extension for sqlite-vec not found" error on affected platforms

### Added
- Cross-platform CLI support using Node.js instead of bash scripts
- Enhanced error handling with clear error messages and troubleshooting guidance
- Automatic dependency validation (npx, tsx) in CLI tools
- Proper symlink resolution for npm link and global installations

### Changed
- CLI entry points now use `.js` extension for universal compatibility
- Replaced `shell: true` spawn calls with direct spawn for improved security
- Updated build configuration to externalize sqlite-vec native module
- Improved process execution without shell interpretation to prevent command injection

### Security
- Removed shell dependencies from CLI execution
- Added input validation and protection against command injection vulnerabilities
- Safer process execution using direct spawn calls

## [1.0.5] - 2025-10-25

### Fixed
- MCP server wrapper now deletes package-lock.json before npm install to ensure platform-specific sqlite-vec packages are installed
- Resolves "Loadable extension for sqlite-vec not found" error on fresh plugin installs

### Changed
- Add package-lock.json to .gitignore to prevent cross-platform optional dependency issues
- Improve wrapper script to handle npm's platform-specific optional dependency installation behavior

## [1.0.4] - 2025-10-23

### Changed
- Strengthen agent and MCP tool descriptions to emphasize memory restoration
- Use empowering "this restores it" framing instead of deficit-focused language
- Make it crystal clear the tool provides cross-session memory and should be used before every task

## [1.0.3] - 2025-10-23

### Fixed
- MCP server now automatically installs npm dependencies on first startup via wrapper script
- Resolves "Cannot find module" errors for @modelcontextprotocol/sdk and native dependencies

### Added
- MCP server wrapper script (`cli/mcp-server-wrapper`) that auto-installs dependencies before starting
- esbuild bundling for MCP server to reduce dependency load time

### Changed
- MCP server now uses wrapper script instead of direct node execution
- Removed SessionStart ensure-dependencies hook (no longer needed)

### Removed
- `cli/ensure-dependencies` script (replaced by MCP server wrapper)

## [1.0.2] - 2025-10-23

### Fixed
- Pre-build and commit dist/ directory to avoid MCP server startup errors
- Remove dist/ from .gitignore to ensure built files are available after plugin install

### Changed
- Built JavaScript files now tracked in git for immediate plugin availability

## [1.0.1] - 2025-10-23

### Added
- Automatic dependency installation on plugin install via SessionStart hook
- `ensure-dependencies` script that checks and installs npm dependencies when needed

### Changed
- Plugin installation now automatically runs `npm install` if `node_modules` is missing
- Improved first-time plugin installation experience

### Fixed
- Plugin dependencies not being installed automatically after plugin installation

## [1.0.0] - 2025-10-14

### Added
- Initial release of episodic-memory
- Semantic search for Claude Code conversations
- MCP server integration for Claude Code
- Automatic session-end indexing via plugin hooks
- Multi-concept AND search for finding conversations matching all terms
- Unified CLI with commands: sync, search, show, stats, index
- Support for excluding conversations from indexing via DO NOT INDEX marker
- Comprehensive metadata tracking (session ID, git branch, thinking level, etc.)
- Both vector (semantic) and text (exact match) search modes
- Conversation display with markdown and HTML output formats
- Database verification and repair tools
- Full test suite with 71 tests

### Features
- **Search Modes**: Vector search, text search, or combined
- **Automatic Indexing**: SessionStart hook runs sync automatically
- **Privacy**: Exclude sensitive conversations from search index
- **Offline**: Uses local Transformers.js for embeddings (no API calls)
- **Fast**: SQLite with sqlite-vec for efficient similarity search
- **Rich Metadata**: Tracks project, date, git branch, Claude version, and more

### Components
- Core TypeScript library for indexing and searching
- CLI tools for manual operations
- MCP server for Claude Code integration
- Automatic search agent that triggers on relevant queries
- SessionStart hook for dependency installation and sync
