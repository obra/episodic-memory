# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
