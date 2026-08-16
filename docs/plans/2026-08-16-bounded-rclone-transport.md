# Bounded rclone transport execution contract

## Scope mode

HOLD SCOPE. Replace direct archive-mount I/O in the sync/search/stats/show path
with a bounded local staging cache, SQLite object ledger, and rclone API object
transport. No activation, installation, live sync, cloud access, or live state
mutation is permitted in this development package.

## Fixed execution contract

- Inputs: local Claude/Codex `.jsonl` transcript files and an explicitly
  configured rclone archive destination.
- Outputs: indexed exchanges plus one `archive_objects` row per uploaded
  transcript; remote object writes and reads happen only through rclone.
- Allowed mutation: source, tests, and temporary test fixtures inside this
  isolated clone. Test doubles may write only to their own temporary folders.
- Forbidden mutation: installed plugin/cache, Codex config, AgentMemory,
  Context Mode, the live rclone/WebDAV mount, Drive archive, production DB,
  snapshots, LaunchAgents, or processes.
- Resource invariants: cache hard limit 4 GiB; unrelated-free-space reserve
  8 GiB; at most one transcript staged/in flight; each run stops before the
  next file after 1 GiB uploaded, 200 files uploaded, or 15 minutes elapsed.
- Concurrency invariant: a separate supervisor process owns the lock and its
  heartbeat while the worker performs all potentially blocking work. The
  supervisor gives its child a one-use random capability over an inherited IPC
  pipe; the worker must complete a challenge/ack before opening SQLite or
  invoking rclone. Missing/closed IPC, mismatch, and direct worker invocation
  fail nonzero before mutation. Eight simultaneous hook starts must yield
  exactly one worker and seven clean exit-0 skips.
- Read invariants: search and stats use SQLite only. `show` downloads exactly
  one requested transcript into the bounded cache, verifies SHA-256 and size,
  formats it, then removes the temporary download.

## Implementation surface

1. `src/archive-ledger.ts` and `src/db.ts`: create and operate the
   `archive_objects` ledger with stable identity, deterministic remote key,
   SHA-256, byte size, line count, source mtime, nullable summary text, summary
   state, upload state, and timestamps. `exchanges.archive_object_id` is
   nullable for legacy rows and never contains a temporary cache path.
2. `src/rclone-transport.ts`: injectable rclone executable for `copyto` and
   streaming remote `cat` readback. Upload success requires the streamed remote
   byte count and SHA-256 to match the staged transcript before publication;
   no provider-native hash support is assumed. Tests poison `PATH` and pass a
   fake executable explicitly, so they cannot call live rclone. Local capacity
   and run-budget gates are evaluated before staging the next transcript.
3. `src/bounded-sync.ts` and `src/sync-cli.ts`: serial one-file staging,
   parse/embed/summary in memory, upload, streamed remote verification, then
   one SQLite transaction that publishes the ledger row and every exchange;
   cleanup follows commit or failure. A verified remote object plus failed DB
   commit is a deterministic, retryable orphan and is never search-visible.
4. `src/sync-supervisor.ts`, `src/file-lock.ts`, a worker entrypoint, and CLI
   dispatch: supervisor owns the lock/heartbeat, performs the IPC challenge,
   and spawns one worker; stale/update timing is injectable for tests.
5. `src/archive-show.ts`, `src/show-cli.ts`, `src/mcp-server.ts`,
   `src/search.ts`, and `src/stats.ts`: CLI and MCP share ledger-backed show;
   search/stats have no archive filesystem or transport reads. Show accepts a
   ledger identity/remote key, never an arbitrary local path in remote mode.
6. Tests and operator documentation: boundary contract tests, unit tests,
   cross-module integration tests, and an eight-contender process test.

## Error and rescue map

| Codepath | Failure | Rescue | Observable result |
|---|---|---|---|
| cache capacity gate | cache would exceed 4 GiB or disk reserve fall below 8 GiB | do not stage; retain ledger/source unchanged | bounded skip/error receipt |
| run budget gate | next file would exceed bytes/files/time | stop before next file | clean bounded completion |
| rclone upload | nonzero exit, timeout, missing remote | retain source; remove staging temp; do not mark uploaded | contextual error, later retry |
| remote verification | missing key, zero/partial stream, size or SHA-256 mismatch | remove staging temp; leave DB unpublished | integrity error |
| ledger write | SQLite busy/error after verified upload | transaction rollback; deterministic remote orphan is reconciled on retry | nonzero worker result |
| rclone download | nonzero exit/timeout | remove partial file | show fails with context |
| checksum/size verify | remote bytes differ from ledger | delete download; never render | integrity error |
| supervisor lock | contention | contender does not spawn worker | exit 0 clean skip |
| worker crash | child nonzero/signal | supervisor releases lock after child exits | nonzero supervisor receipt |
| supervisor/IPC | spawn failure, closed pipe, token mismatch, timeout | no worker mutation; release lock | contextual nonzero result |
| heartbeat | heartbeat compromise while child runs | terminate child; release/diagnose lock | contextual nonzero result |
| cleanup | partial download cannot be removed | report integrity/cleanup error; never render | nonzero show result |

Legacy exchange rows remain SQLite-searchable. They have a null
`archive_object_id`, no transport metadata, and `show` returns `not transported`;
there is no mount/filesystem fallback. Any live backfill belongs to a separately
authorized migration and activation contract.

## Mechanical acceptance

- L0: fake-rclone contract tests assert exact `copyto` argument boundaries,
  streamed readback, timeout propagation, unavailable executable/capability,
  zero-byte behavior, and checksum rejection.
- L1: ledger schema/transactions, capacity math, budget boundary, and
  SQLite-only formatter/stat behavior tests.
- L2: temporary source -> staging -> fake remote -> ledger -> show round trip;
  persisted ledger rows are read back from SQLite, not hand-built fixtures.
- Process integration: spawn eight supervisors against one instrumented test
  worker; assert one invocation, seven explicit skip messages, eight exit-0
  results, heartbeat mtime advancement while the worker blocks, and release
  only after child exit/signal/timeout. Direct workers fail before mutation.
- Failure integration: upload failure/timeout, remote readback mismatch,
  SQLite failure after verified upload, and idempotent orphan reconciliation.
- Query isolation: search/stats pass with nonexistent archive paths and a
  transport implementation that throws if called.
- Show integration: exactly one `copyto` download; verify byte size and SHA-256
  before formatting; cleanup on success, parse error, checksum mismatch, and
  signal.
- Native gates: `npm test` and `npm run build` return zero.
- Independent gate: a different review agent inspects the final diff and all
  material findings receive a directly affected test before completion.

## Rollback

This clone is disposable. Before delivery, record `git diff --stat` and the
base commit. Rollback is deletion of the isolated clone or reverting only this
clone's uncommitted changes; no live data/config rollback is necessary because
live surfaces are excluded from execution.
