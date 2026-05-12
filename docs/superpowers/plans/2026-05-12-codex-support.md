# Codex Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make episodic-memory installable and useful from both Claude Code and Codex, with a shared conversation index and harness-native parsing, hooks, skills, and summaries.

**Architecture:** Keep the existing shared archive and SQLite index, but add explicit harness adapters for source discovery, transcript parsing, display, and summarization. Claude continues to use Claude transcript shape and resumable Claude summaries; Codex gets rollout parsing plus a Codex summarizer path that can use resumed/forked Codex context when available.

**Tech Stack:** TypeScript, Node.js, Vitest, SQLite via better-sqlite3/sqlite-vec, Codex plugin manifests/hooks/MCP config, Claude Agent SDK for Claude summaries, Codex CLI/app-server surfaces for Codex summaries.

---

### Task 1: Codex Plugin Packaging

**Files:**
- Create: `.codex-plugin/plugin.json`
- Create: `.mcp.json`
- Modify: `.version-bump.json`
- Test: `test/codex-plugin.test.ts`
- Test: `test/version-consistency.test.ts`

- [ ] **Step 1: Write packaging tests**

Add `test/codex-plugin.test.ts` asserting:
- `.codex-plugin/plugin.json` exists and has `name`, `version`, `skills`, `hooks`, `mcpServers`, and `interface`.
- `mcpServers` is a string path to `.mcp.json`.
- `.mcp.json` defines the `episodic-memory` MCP server using `node`, `./cli/mcp-server-wrapper.js`, and `cwd: "."`.
- `.version-bump.json` includes `.codex-plugin/plugin.json`.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- test/codex-plugin.test.ts test/version-consistency.test.ts`

Expected: FAIL because `.codex-plugin/plugin.json` and `.mcp.json` do not exist and version sync does not include the Codex manifest.

- [ ] **Step 3: Implement minimal packaging**

Create `.codex-plugin/plugin.json` using the existing Claude metadata, but with Codex fields:
- `skills: "./skills/"`
- `hooks: "./hooks/hooks.json"`
- `mcpServers: "./.mcp.json"`
- Interface copy that describes cross-harness conversation memory.

Create `.mcp.json`:
```json
{
  "mcpServers": {
    "episodic-memory": {
      "command": "node",
      "args": ["./cli/mcp-server-wrapper.js"],
      "cwd": "."
    }
  }
}
```

Add `.codex-plugin/plugin.json` to `.version-bump.json`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npm test -- test/codex-plugin.test.ts test/version-consistency.test.ts`

- [ ] **Step 5: Commit**

Run:
```bash
git add .codex-plugin/plugin.json .mcp.json .version-bump.json test/codex-plugin.test.ts
git commit -m "feat: add Codex plugin packaging"
```

### Task 2: Harness-Aware Transcript Sources and Codex Parsing

**Files:**
- Modify: `src/types.ts`
- Modify: `src/paths.ts`
- Modify: `src/parser.ts`
- Modify: `src/sync.ts`
- Modify: `src/db.ts`
- Test: `test/parser-codex.test.ts`
- Test: `test/sync-codex.test.ts`
- Test: `test/db.test.ts`

- [ ] **Step 1: Write Codex parser/source tests**

Add `test/parser-codex.test.ts` with a small Codex rollout containing:
- `session_meta` with `id`, `cwd`, `cli_version`, `model_provider`, and `git`.
- `turn_context` with `model`.
- `response_item` user/assistant messages.
- `response_item` function call/tool output.
- `response_item` reasoning with summary and encrypted content.

Assert parsing yields one exchange with:
- `harness: "codex"`
- `sessionId` from `session_meta.payload.id`
- `cwd`, `gitBranch`, `agentVersion`, `model`, `modelProvider`
- assistant text from Codex message content
- a tool call from `function_call`
- reasoning summary metadata when present

Add `test/sync-codex.test.ts` asserting `getConversationSourceDirs()` includes `~/.codex/sessions` when present and `syncConversations()` can copy/index a Codex rollout path.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- test/parser-codex.test.ts test/sync-codex.test.ts test/db.test.ts`

Expected: FAIL because Codex source discovery and parser support do not exist.

- [ ] **Step 3: Add shared harness types**

Extend `ConversationExchange` with:
- `harness?: "claude" | "codex"`
- `agentVersion?: string`
- `model?: string`
- `modelProvider?: string`

Keep `claudeVersion` for compatibility, but populate both `claudeVersion` and `agentVersion` for Claude.

- [ ] **Step 4: Add Codex source discovery**

In `src/paths.ts`, add `getCodexDir()` and include `~/.codex/sessions` in `getConversationSourceDirs()` when it exists. Preserve `TEST_PROJECTS_DIR` as the full override.

- [ ] **Step 5: Add parser dispatch**

In `src/parser.ts`, detect transcript kind from the first valid JSONL line:
- Claude if top-level `type` is `user` or `assistant`.
- Codex if top-level `type` is one of `session_meta`, `turn_context`, `response_item`, `event_msg`.

Move existing logic into the Claude parser path and add a Codex parser path.

- [ ] **Step 6: Persist harness metadata**

Add DB migrations and insert/select support for `harness`, `agent_version`, `model`, and `model_provider`. Keep existing columns untouched.

- [ ] **Step 7: Run tests to verify GREEN**

Run: `npm test -- test/parser-codex.test.ts test/sync-codex.test.ts test/db.test.ts`

- [ ] **Step 8: Commit**

Run:
```bash
git add src/types.ts src/paths.ts src/parser.ts src/sync.ts src/db.ts test/parser-codex.test.ts test/sync-codex.test.ts test/db.test.ts
git commit -m "feat: parse and index Codex transcripts"
```

### Task 3: Harness-Native Summaries

**Files:**
- Modify: `src/summarizer.ts`
- Modify: `src/sync.ts`
- Modify: `src/indexer.ts`
- Test: `test/summarizer-options.test.ts`
- Test: `test/sync.test.ts`

- [ ] **Step 1: Write summarizer tests**

Extend `test/summarizer-options.test.ts` to assert:
- Claude summaries still build Claude Agent SDK options with `resume` and `persistSession: false`.
- Codex summaries build a `codex exec` command with reentrancy guard env and an output file.
- Codex summaries use session id from Codex rollout metadata.
- If Codex resume is unavailable or disabled, summaries fall back to transcript text rather than failing the index.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- test/summarizer-options.test.ts test/sync.test.ts`

Expected: FAIL because only Claude summary options exist and sync drops `sessionId`.

- [ ] **Step 3: Fix session id propagation**

Pass `sessionId` into `summarizeConversation()` from `sync.ts` and `indexer.ts` where known. This fixes the existing Claude resume bug as part of the harness work.

- [ ] **Step 4: Add summarizer adapter**

Change `summarizeConversation()` to accept `{ harness, sessionId, transcriptPath }`. Route:
- Claude: current Claude Agent SDK path.
- Codex: Codex CLI path when `sessionId` exists and Codex executable is available.
- Fallback: transcript-text summary using existing prompt.

Use `EPISODIC_MEMORY_SUMMARIZER_GUARD=1` for all spawned summarizers.

- [ ] **Step 5: Codex command shape**

Use a conservative wrapper so the command can be swapped when Codex exposes true noninteractive ephemeral fork:
```text
codex exec --ignore-rules --skip-git-repo-check --output-last-message <tmp> resume <session-id> <prompt>
```

Document in code that `thread/fork ephemeral` is the quality target, because `thread/resume` does not currently accept an `ephemeral` flag.

- [ ] **Step 6: Run tests to verify GREEN**

Run: `npm test -- test/summarizer-options.test.ts test/sync.test.ts`

- [ ] **Step 7: Commit**

Run:
```bash
git add src/summarizer.ts src/sync.ts src/indexer.ts test/summarizer-options.test.ts test/sync.test.ts
git commit -m "feat: add harness-native summarization"
```

### Task 4: Codex Skills and Readable Display

**Files:**
- Modify: `skills/remembering-conversations/SKILL.md`
- Modify: `agents/search-conversations.md`
- Modify: `src/show.ts`
- Test: `test/search-agent-template.test.ts`
- Test: `test/show.test.ts`

- [ ] **Step 1: Write display/skill tests**

Add show tests for Codex rollout markdown output. Update search-agent-template tests to assert skill text does not require Claude-only `Task tool` syntax and mentions Codex direct MCP use.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- test/search-agent-template.test.ts test/show.test.ts`

- [ ] **Step 3: Update skill guidance**

Rewrite the skill to:
- Prefer a search subagent when the harness provides one.
- In Codex, use the MCP search/read tools directly if no plugin-specific agent is installed.
- Keep source pointers in output.

- [ ] **Step 4: Update display**

Make `show.ts` dispatch to Claude or Codex markdown rendering based on transcript kind.

- [ ] **Step 5: Run tests to verify GREEN**

Run: `npm test -- test/search-agent-template.test.ts test/show.test.ts`

- [ ] **Step 6: Commit**

Run:
```bash
git add skills/remembering-conversations/SKILL.md agents/search-conversations.md src/show.ts test/search-agent-template.test.ts test/show.test.ts
git commit -m "feat: make recall skill and display Codex-aware"
```

### Task 5: Final Verification

**Files:**
- All changed files.

- [ ] **Step 1: Build**

Run: `npm run build`

- [ ] **Step 2: Full tests**

Run: `npm test`

- [ ] **Step 3: Inspect diff**

Run: `git status --short` and `git diff --stat origin/main...HEAD`.

- [ ] **Step 4: Commit any final fixes**

Commit only if verification surfaces necessary fixes.
