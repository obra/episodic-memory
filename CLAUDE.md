# Project Instructions: episodic-memory

A Claude Code plugin that gives semantic search across past Claude Code conversations. This file holds the conventions an AI assistant needs to work on this codebase safely.

## Quick orientation

- **TypeScript source** in `src/`, compiled to `dist/` by `tsc && esbuild`. Both are committed.
- **CLI entry points** in `cli/` (Node.js wrappers — no bash).
- **MCP server** is `dist/mcp-server.js`, launched by `cli/mcp-server-wrapper.js` from the plugin manifest.
- **Tests** live in `test/`, run via `vitest`.
- **Generated files** live in `dist/` and `src/version.ts`. The latter is gitignored; never edit it.

## Build and test

```
npm test          # full suite, runs prebuild step that generates src/version.ts
npm run build     # tsc + esbuild bundle
npm run generate-version   # writes src/version.ts from package.json
```

The `prebuild` and `pretest` hooks both regenerate `src/version.ts`. After source changes that touch the MCP server or any imported module, run `npm run build` so `dist/` reflects source. Commit `dist/` alongside `src/`.

## Version management

Three files hold the plugin version, all kept in lockstep:

- `package.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json` (plugins[0].version)

Plus a fourth thing outside this repo:

- `../superpowers-marketplace/.claude-plugin/marketplace.json` (the user-visible install registry)

To bump in this repo:

```
./scripts/bump-version.sh X.Y.Z         # updates all three local files
./scripts/bump-version.sh --check       # report current versions
./scripts/bump-version.sh --audit       # scan for stale references
```

The script reads `.version-bump.json` for the file list and audit excludes. `MCP server identity` (the `version` field in `new Server({...})` in `src/mcp-server.ts`) is derived from `src/version.ts`, which the prebuild script generates from `package.json` — keep that pipeline in place; never hardcode the version.

## Release engineering

Follow this every time:

1. **Test:** `npm test` (full suite must pass)
2. **Build:** `npm run build` (commits `dist/` need to be fresh)
3. **Bump:** `./scripts/bump-version.sh X.Y.Z` and verify clean audit
4. **Changelog:** add an entry to `CHANGELOG.md`. Write for end users, not engineers — concrete numbers, plain English, active voice. Lead with the user-visible benefit.
5. **Commit and tag:**
   ```
   git commit -m "Release vX.Y.Z: <one-line>"
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin main && git push origin vX.Y.Z
   ```
6. **GitHub release:**
   ```
   awk '/^## \[X\.Y\.Z\]/,/^## \[/' CHANGELOG.md | sed '$d' | tail -n +2 > /tmp/notes.md
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file /tmp/notes.md
   ```
7. **Bump the marketplace registry** (the load-bearing step that's easy to forget):
   ```
   cd ../superpowers-marketplace
   git pull
   # edit .claude-plugin/marketplace.json, set the episodic-memory entry's
   # "version" to X.Y.Z
   git commit -m "Update episodic-memory to vX.Y.Z" && git push
   ```
   Without this, `/plugin install episodic-memory@superpowers-marketplace` continues serving the previous version. **Users install from the marketplace, not from this repo's tags.**
8. **Smoke test from the published release:** clone the new tag into a tmp dir, `npm install && npm run build && npm test`, then run a synthetic sync + search end-to-end. The full suite covers most paths but doesn't exercise first-install model download or MCP boot.

## Things to be careful with

### The summarizer recursion guard (#87)

`summarizer.ts` calls the Claude Agent SDK's `query()`, which spawns a Claude subprocess that fires `SessionStart` hooks. Our own `SessionStart` hook runs `sync --background`, which calls the summarizer. That loop fans out hundreds of processes within seconds.

The fix:
- `getApiEnv()` always sets `EPISODIC_MEMORY_SUMMARIZER_GUARD=1` in the env it returns to the SDK
- `sync-cli.ts` checks `shouldSkipReentrantSync()` at startup and exits silently when the guard is set

**Anything new that spawns a Claude subprocess via the SDK must inherit this guard.** And nothing should run `sync --background` without checking the guard first. Test with `test/sync-cli-reentrancy.test.ts` style integration if you change the spawn path.

### Embedding migration (1.2.0+)

The `exchanges.embedding_version` column tracks which encoder produced each row's vector. New code stamps `EMBEDDING_VERSION` (in `src/embedding-migration.ts`); old rows from earlier installs default to 0. The sync flow re-embeds stale rows in batches behind a lock at `~/.config/superpowers/conversation-index/.embedding-migration.lock`.

If you change anything in the embedding pipeline (model, dtype, prefix, pooling, normalization, truncation), **bump `EMBEDDING_VERSION`**. That triggers automatic re-embedding for everyone on upgrade. Don't change pipeline behavior silently — search results would degrade against indexed vectors from the old pipeline.

### `dist/` is committed

Hand-edits to `dist/` get clobbered by `npm run build`. Always edit `src/`, then build, then commit both together. CI doesn't rebuild for you.

### Test isolation

Tests use `mkdtempSync`, set `TEST_DB_PATH`/`TEST_PROJECTS_DIR`/`EPISODIC_MEMORY_CONFIG_DIR` per-test, and clean up in `afterEach`. Don't reach for the real `~/.config/superpowers/`. The `test-utils.ts` helpers cover the common patterns.

## File layout

```
src/
  embeddings.ts          # encoder pipeline; query and exchange embedders
  embedding-migration.ts # version constant + lock + batch migration
  search.ts              # vector + text search; multi-concept aggregation
  indexer.ts             # incremental index from sources to vec_exchanges
  sync.ts / sync-cli.ts  # source→archive copy + index, with reentrancy guard
  summarizer.ts          # Claude Agent SDK calls; persistSession: false guard
  db.ts                  # schema + migrations (incl. cascade + embedding_version)
  paths.ts               # config/index/archive directory resolution
  parser.ts              # JSONL transcript → exchanges
  mcp-server.ts          # MCP tool surface (search, read)
  version.ts             # GENERATED — do not edit

cli/
  episodic-memory.js     # umbrella CLI dispatcher
  mcp-server-wrapper.js  # ensures deps are installed before launching the server
  *.js                   # subcommand entry points

scripts/
  bump-version.sh        # version bumper with drift audit
  generate-version.js    # writes src/version.ts from package.json
```

## When in doubt

Read the relevant test file. Tests in this repo are the executable spec — particularly `test/embedding-migration.test.ts`, `test/sync-cli-reentrancy.test.ts`, and `test/tool-calls-cascade.test.ts`. They cover the load-bearing invariants (lock contention, recursion-guard, schema migrations) and exercise the real subsystems rather than mocking them.
