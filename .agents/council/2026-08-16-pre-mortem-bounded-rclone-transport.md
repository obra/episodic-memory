---
id: pre-mortem-2026-08-16-bounded-rclone-transport
type: pre-mortem
date: 2026-08-16
source: "[[docs/plans/2026-08-16-bounded-rclone-transport]]"
prediction_ids:
  - pm-20260816-001
  - pm-20260816-002
  - pm-20260816-003
  - pm-20260816-004
---

# Pre-Mortem: Bounded rclone transcript transport

## Council Verdict: PASS

| ID | Judge | Finding | Severity | Prediction |
|---|---|---|---|---|
| pm-20260816-001 | Feasibility | Budget accounting happens after staging | significant | A large next transcript exceeds cache or run bounds before the worker stops |
| pm-20260816-002 | Concurrency | Worker can bypass the supervisor | significant | Two writers reach SQLite or rclone despite a healthy heartbeat |
| pm-20260816-003 | Integrity | Ledger is marked uploaded before remote checksum proof | significant | Search points at an incomplete or corrupt remote object |
| pm-20260816-004 | Propagation | Search or stats retains a filesystem metadata read | significant | A supposedly local query blocks on the cloud mount |

## Pseudocode Fixes

Finding: F1 - Gate the next object before staging

```ts
const next = statSource(path);
if (!budget.canStart(next.size, now()) || !cache.canStage(next.size, diskFree())) {
  return { status: 'bounded-stop', reason };
}
await stageOne(path);
```

Finding: F2 - Require supervisor-owned writer capability

```ts
if (!process.send || !process.connected) throw new Error('supervisor IPC required');
process.send({ type: 'challenge', token });
await expectOneUseAckOverInheritedIpc(token);
await runSingleWriter();
```

Finding: F3 - Commit ledger only after transport and integrity gates

```ts
await rclone.copyto(staged, remoteKey);
const remote = await rclone.streamRemoteBytes(remoteKey);
assertEqual(remote.bytes, local.bytes);
assertEqual(remote.sha256, local.sha256);
db.transaction(() => {
  ledger.markUploaded(object);
  insertAllExchanges(exchanges);
})();
```

Finding: F4 - Format query results from persisted columns only

```ts
const metadata = ledger.getById(exchange.archiveObjectId);
return format({ exchange, bytes: metadata?.sizeBytes, lines: metadata?.lineCount });
```

## Known Risks Applied

- Missing mechanical verification: every invariant has a zero/nonzero test.
- Self-assessment: independent pre-code and post-code reviewers are required.
- Propagation blindness: CLI, hook entry, DB, search, stats, show, docs, and
  tests are enumerated.
- Missing rollback: no live surface is changed; clone deletion is sufficient.
- Four-surface closure: code, operator documentation, examples, and test proof
  are included.

## Timeline Risks

| Phase | Risk | Mechanical response |
|---|---|---|
| Hour 1 | dependency or test harness unavailable | install only inside clone; run one baseline test |
| Hour 2 | ledger and transport contracts diverge | shared persisted-row integration fixture |
| Hour 4 | supervisor child lifecycle hangs | bounded child timeout and eight-process test |
| Hour 6+ | legacy archive reads remain | exhaustive Graft/raw literal sweep plus tests |

## Independent Gate Findings Applied

- IPC challenge/ack replaces the forgeable environment-only token.
- Streamed remote readback proves bytes and SHA-256 without assuming provider
  hash support or creating a second cache file.
- Publication is one post-verification SQLite transaction.
- Ledger includes line count and summary content/state; MCP and CLI show share
  one transport service.
- Legacy rows are search-only and fail show closed with `not transported`.
- Rescue tests now cover spawn, IPC, heartbeat, transport, transaction, retry,
  and cleanup failure paths with an explicit fake executable.

## Recommendation

The independent re-review passed. Implementation then received an independent
code review; its timeout-release, heartbeat-compromise, and stale-exchange
findings were fixed with directly affected regression tests.

## Decision Gate

[x] PROCEED - Council passed, ready to implement
[ ] ADDRESS - Independent review pending
[ ] RETHINK - Fundamental issues, needs redesign
