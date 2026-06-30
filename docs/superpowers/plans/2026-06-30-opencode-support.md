# OpenCode Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add first-party opencode support to episodic-memory, including session import, parsing, a plugin hook, docs, and tests.

**Architecture:** opencode stores conversations in `~/.local/share/opencode/opencode.db`, so sync will export sessions from SQLite into an internal JSONL archive format instead of trying to index the DB directly. The parser will recognize this format as a third harness and produce the same `ConversationExchange` records used by Claude Code and Codex. The package will also expose an opencode plugin module that runs `episodic-memory sync --only opencode` on `session.idle`.

**Tech Stack:** TypeScript, Node.js ESM, `better-sqlite3`, Vitest, opencode plugin API.

---

### Task 1: opencode Archive Export

**Files:**
- Create: `src/opencode-sync.ts`
- Modify: `src/paths.ts`
- Test: `test/opencode-sync.test.ts`

**Steps:**
1. Add tests that create a small opencode SQLite DB with `session`, `message`, and `part` rows.
2. Implement helpers for resolving the opencode data dir, DB path, and export destination.
3. Export changed sessions into `conversation-archive/opencode/<project>/<session>.jsonl`.
4. Run the focused test and verify copied/skipped behavior.

### Task 2: opencode Parser

**Files:**
- Modify: `src/parser.ts`
- Modify: `src/types.ts`
- Test: `test/opencode-transcripts.test.ts`

**Steps:**
1. Add tests for exported opencode JSONL: user text, assistant text, metadata, and tool parts.
2. Extend `ConversationHarness` with `opencode`.
3. Detect opencode JSONL records and parse them into `ConversationExchange`.
4. Run focused parser tests.

### Task 3: Sync Integration

**Files:**
- Modify: `src/sync.ts`
- Modify: `src/sync-cli.ts`
- Modify: `src/doctor.ts`
- Test: `test/sync.test.ts`, `test/opencode-doctor.test.ts`

**Steps:**
1. Add a `--only opencode` sync option for plugin-triggered syncs.
2. Call opencode export before indexing archive files.
3. Add doctor checks for opencode CLI version, DB path, and archive path.
4. Run focused sync and doctor tests.

### Task 4: opencode Plugin Packaging

**Files:**
- Create: `src/opencode-plugin.ts`
- Modify: `package.json`
- Test: `test/opencode-plugin.test.ts`

**Steps:**
1. Add a plugin module exporting `server`.
2. On `session.idle`, run `episodic-memory sync --only opencode --summary-limit 10` in the background.
3. Export the module from package metadata so opencode can load it from npm.
4. Run packaging tests.

### Task 5: Docs and Verification

**Files:**
- Modify: `README.md`
- Create: `docs/OPENCODE.md`
- Modify: `skills/remembering-conversations/SKILL.md`

**Steps:**
1. Document opencode installation, plugin config, MCP setup, sync behavior, and troubleshooting.
2. Update the memory skill to mention opencode alongside Claude Code and Codex.
3. Run `npm run build` and `npm test`.
