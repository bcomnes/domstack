# Issue 334: duplicate-build investigation

This follows the duplicate builds found during [Oro resource profiling](334-cache-resource-results.md).
The investigation adds diagnostics and deterministic tests, but changes no production watch behavior.
No commits were made, and Oro's installed beta.8 package was restored after every local-link run.

## Finding

A single in-place `fs.promises.writeFile()` can produce separate filesystem notifications for truncation and the completed write.
DOMStack can start a build from the truncation notification, before the write promise resolves.
If the second notification reaches Chokidar after its 50 ms change-event throttle expires, it becomes a new DOMStack event while the first build is active.
The coordinator correctly puts that event into the next batch.
Both workers can subsequently read the same completed document, making the second build redundant despite correct event delivery and output content.

A controlled main-thread pause reproduced this mechanism on **both published beta.8 and the optimized candidate**.
It does not require the source-preparation cache.
No internal event replay or completion-triggered retry was found in the coordinator.
This does not prove the exact cause of every earlier natural duplicate or establish that the optimization cannot change its frequency.

## Observation points

The opt-in `oro-website/tools/trace-domstack-watch.mjs` preload records:

- The driver source-write start/completion, byte count, and SHA-256.
- Chokidar raw file/directory notifications.
- The old/new file stats used by Chokidar's file handler.
- Emitted source events and their arrival while the coordinator is draining.
- Batch detachment/execution boundaries.
- Worker source-read byte counts and SHA-256 values.

Records are buffered per isolate and written at shutdown, rather than synchronously writing a log on every notification.
The instrumentation adds no source-file reads, and no source contents are logged.
Module-load hooks validate exact source anchors and do not patch files on disk.
The trace nevertheless changes execution and allocation slightly, so its timing is diagnostic, not a benchmark replacement.

## Natural traced runs

Each implementation ran three fresh watch sessions across two Node invocations, with one warm-up and a total of 40 measured edits per implementation.
All 80 measured edits and six warm-ups produced one build and passed HTML, raw Markdown, search, LLM, and unchanged-sibling assertions.
Thus, these natural traced runs did **not** capture the earlier intermittent duplicate.
The earlier uninstrumented evidence is retained, not replaced by these clean traces.

All 86 traced writes initially emitted a `change` with a zero-byte source-file stat.
Subsequent observations saw the completed document before worker preparation read it.
In these runs the relevant directory notifications arrived roughly 10–22 ms after write start, within Chokidar's change throttle.
This exposed the intermediate filesystem state and suggested testing delayed notification handling explicitly.

## Controlled scheduling reproduction

For one additional session per implementation, the tracer requests a 100 ms main-thread pause immediately after the first edit's event batch detaches.
Only that first batch is paused; no second write or synthetic source event is introduced.
This deliberately changes scheduling and must not be classified as a natural duplicate-rate measurement.

The candidate trace records the following sequence for a single 4,052-byte write:

| Time from write start | Observation |
| --- | --- |
| 0.59 ms | Chokidar emits `change` with size 0 |
| 0.85 ms | DOMStack detaches the first batch; the controlled pause follows |
| 116.73 ms | Chokidar emits `change` with size 4,052; it is queued while the first batch is active |
| 116.82 ms | The driver's single write promise completes |
| 302.32 ms | First worker reads the completed document |
| 492.55 ms | First batch finishes |
| 492.70 ms | Second batch starts from the queued notification |
| 679.23 ms | Second worker reads identical completed bytes |
| 865.42 ms | Second batch finishes |

Both worker source hashes match the one driver's write hash.
Beta.8 follows the same sequence: the two emitted changes arrive at approximately 0.69 ms and 108.00 ms, and both workers read the same completed source.
Each implementation produced two builds for the paused warm-up and one build for each of the two subsequent unpaused edits.
All output assertions passed.

The injected pause demonstrates that delayed processing alone is sufficient to reproduce the observed output pattern.
It does not identify whether GC, serialization, OS scheduling, I/O, or another delay caused the older uninstrumented samples.

## Why the second build is HTML-only

The direct Markdown event selects the HTML page in each batch.
On the first build, the producer publishes changed search/LLM data, invalidating its subscribers.
On the second build, the producer sees equivalent document data and returns equal public fingerprints, so those templates are not invalidated again.
The directly selected HTML page still writes.
This is not an application-global-data retry and does not imply the producer was skipped.

The relevant implementation boundaries are:

- `lib/watch/index.js`: source event recording, `#scheduleWatchBatch()`, and `#executeWatchPlan()`.
- `lib/watch/plan.js`: direct source-page selection and batch-local input deduplication.
- `lib/build-pages/global-data/watch-dependencies.js`: public-value fingerprint comparison and subscriber selection.

`atomic: 300` handles unlink/add replacement saves; it is not a write-completion delay for ordinary in-place writes.
`setImmediate()` coalesces one event-loop turn, not all notifications belonging to an editor save.
`settled()` drains known work; it cannot guarantee that the OS will not deliver another event later.

## Stabilization experiment, not a production change

A second controlled session for each implementation temporarily enabled this Chokidar option through the diagnostic hook:

```js
awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 }
```

The same requested 100 ms pause then produced **one build** on both implementations.
Their first source events arrived with the completed 4,052-byte size at approximately 70 ms, after the driver's write completed at approximately 1 ms.
Each subsequent unpaused edit also produced one build, and all output assertions passed.

This is evidence that source-write stabilization can address this reproduction without discarding callbacks during an active build.
It is not a universal guarantee against duplicate OS events or partially written files.
A writer that pauses longer than the stability threshold can still expose an intermediate state.

Do not enable this unconditionally merely to make the benchmark single-build:

- It adds a quiet-period/polling delay to every affected source edit.
- It coalesces rapidly successive writes and changes when errors/intermediate states become visible.
- Its polling and timing behavior require broader lifecycle, slow-write, deletion, and atomic-save coverage before shipping.

Decision after this investigation: skip stabilization in the current optimization pass and proceed with fingerprinting.
Chokidar already provides the optional `awaitWriteFinish` feature, but it remains disabled; its built-in change throttle and our `atomic: 300` setting remain unchanged.
Any future opt-in write-stability setting needs its own latency and event-semantics evaluation.
Do not drop all events for an actively building path, compare only sizes/mtimes as proof of content equality, or silently change the benchmark to atomic saves.
Those shortcuts can lose real edits or hide the workload being investigated.
The duplicate investigation need not force a new invalidation contract into the Markdown cache.

## Deterministic coverage

`lib/watch/duplicate-events.test.js` adds three tests using controlled source-event delivery with real workers and output generation:

1. One callback builds once; duplicate callbacks in the same turn coalesce while preserving their ordered event entries.
2. An identical callback delivered during an active, gated build, with no second write, produces two builds but only one subscriber update.
3. A genuinely different second edit during the active build survives, updating both final HTML and subscriber output.

Worker starts, HTML selections, and template invocations have explicit counters outside the source tree.
These are characterization and edit-preservation tests, not a claim that native duplicate notifications have been fixed.

## Validation and evidence

- New test file alone: 3 passed.
- New tests plus incremental global-data and Markdown-cache watch tests: 24 passed, 2 existing TODOs, no failures.
- Full DOMStack type checking and lint passed.
- Oro type checking and trace-tool syntax checking passed.
- Natural traces: 80 measured edits plus six warm-ups passed output checks.
- Controlled pause/stabilization experiments: all 12 writes passed output checks across four sessions.

Ignored evidence under `oro-website/test-results/`:

- `domstack-trace-{candidate,beta8}-{1,2}.jsonl` and corresponding driver JSON.
- `domstack-trace-{candidate,beta8}-stall100.jsonl` and corresponding driver JSON.
- `domstack-trace-{candidate,beta8}-stall100-awf50.jsonl` and corresponding driver JSON.
- `run-domstack-trace.py`, which selects/restores the local dependency in `finally`.

No existing application sources, package manifest, lockfile, or original public output were changed.
The next optimization candidates remain fingerprinting and dependency-analysis reuse; stabilization is a separate behavior/performance decision rather than an unreviewed default change.
