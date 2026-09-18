# Issue 334: single-use worker prewarming results

Phase 6B of the [watch-performance plan](334-watch-preparation-performance.md) is implemented and accepted for the measured latency/resource tradeoff.
Watch sessions prepare at most one unused page worker after the current build queue drains.
Each worker still executes application build code only once and is retired before that build settles.
This is not persistent application-worker reuse.

## Ownership and protocol

`lib/build-pages/worker/page-worker-pool.js` owns starting, ready, active, and retiring page workers.
Its internal `warm()`, `build()`, `stopWarming()`, and `close()` operations separate speculative preparation from draining required builds.
The watch coordinator stores one owner on each `WatchSession`, rather than sharing workers across sessions or facades.

- The worker statically loads DOMStack's build graph, then sends `{ type: 'ready' }`.
- The parent sends one `{ type: 'build', src, dest, siteData, opts }` request with the existing cloneable option allowlist and reset rules.
- The worker performs the build and sends `{ type: 'result', result }`.
- Only a result after dispatch completes a build; readiness is not a result.
- The parent restores domain errors, retires the worker, and awaits termination before settling the operation.

Application layouts, globals, page modules, templates, generated factories, and Markdown settings are imported by build execution, not by DOMStack's idle preparation.
Application module state is not reused on the next job, including after failed builds.
All required application output work must be awaited before returning; timers or unawaited background work do not survive worker retirement.
One-off `buildPages()` calls use the same single-use protocol but do not create speculative replacements.

Warming happens only when startup enters the watching state without buffered edits, or after the entire batch-drain loop finishes.
A build arriving during preparation consumes that starting worker and waits for readiness.
Queued bursts do not trigger speculative replacement between their builds.
`settled()` continues to describe queued build completion, not speculative readiness.

Stopping immediately disables speculation and retires an unused worker, but an already-draining startup/full-rebuild pipeline may still request its required page build.
Final disposal awaits startup, the build queue, active work, and retirement before releasing the session.
Session identity/state guards prevent obsolete callbacks from warming replacements.

### Context and preload safeguards

A worker captures the current environment, working directory, and execution arguments at construction.
After readiness, the parent compares that context immediately before dispatch and replaces a stale worker rather than executing against an outdated environment.
Environment additions and deletions count as changes; values are neither shared with application workers nor logged.

Speculative warming is bypassed when inherited `process.execArgv` or `NODE_OPTIONS` contains code-loading hooks such as `--import`, `--require`/`-r`, `--loader`, or `--experimental-loader`/`--experimental_loader`.
Those hooks can import site modules before DOMStack's handshake, so prewarming them would require a new application isolation contract.
Cold builds preserve inherited flags and loader behavior unchanged.
The guard is deliberately conservative and can bypass warming for flag-like text in arguments.
No new public option or application API is required.

### Failure handling

Unexpected worker errors, message-deserialization errors, invalid/out-of-order messages, input-clone failures, and exits before a result all settle the request and retire the worker.
A clean exit with code zero before a result is a failure rather than a permanently pending build.
A successful result is marked received before intentional termination, so termination's usual nonzero exit code does not overwrite success.
Speculative failures are observed without unhandled rejections or an idle respawn loop; a later build can create a fresh worker.

Result-serialization failure is still a failed build, but must not erase records of already-written outputs.
The fallback preserves cloneable page/template/output ownership, independently cloneable cache/report fields, and recoverable error metadata, while adding a transport error.
If mandatory ownership itself cannot be cloned, the operation fails rather than inventing an empty report.
A regression writes a partial sidecar, triggers an uncloneable error cause, then verifies that successful recovery removes that sidecar through the normal output ledger.

## Controlled Oro latency comparison

Three variants share Oro's installed dependencies:

1. **Before:** the completed phase-5 runtime, with no phase-6 runtime changes.
2. **Cold protocol:** the new handshake, dispatch, error handling, and retirement, with `warm()` disabled only in the measurement snapshot.
3. **Prewarmed:** the same protocol with normal watch-session warming enabled.

The before/after runtime differences are the four changed worker/watch modules plus the new pool module.
The cold and warm snapshots differ only by an early return in `warm()`.
The measured warm runtime was checked byte-for-byte against the working tree, with a SHA-256 audit retained in ignored evidence.

Measurements used Node v26.8.2 on macOS arm64 and the existing real Oro driver with 605 source pages.
Each variant ran in three fresh processes, each with one excluded warm-up and five measured edits.
Round order rotated before/cold/warm, cold/warm/before, and warm/before/cold.
All timing runs were uninstrumented and sequential, without concurrent tests or benchmarks.

| Measurement | Before | Cold protocol | Prewarmed |
| --- | ---: | ---: | ---: |
| Measured edits | 15 | 15 | 15 |
| Median edit-to-settled, all measured edits | 305.16 ms | 318.74 ms | 220.36 ms |
| p95 edit-to-settled, all measured edits | 322.07 ms | 327.73 ms | 525.40 ms |
| Single-build measured edits | 15 | 15 | 14 |
| Median single-build edit-to-settled | 305.16 ms | 318.74 ms | 220.02 ms |
| p95 single-build edit-to-settled | 322.07 ms | 327.73 ms | 231.84 ms |
| Median initial watch startup | 5.780 s | 6.196 s | 6.135 s |
| Initial startup range | 5.775–6.213 s | 5.829–6.343 s | 5.789–6.215 s |

Prewarming reduced the all-edit median by **84.80 ms, or 27.8%**, versus the previous runtime.
Compared with the same protocol without warming, the reduction was **98.38 ms, or 30.9%**.
The cold protocol was **13.58 ms, or 4.4%, slower** than the previous path; handshake/dispatch and awaited retirement are not free.
Initial builds remain cold, and these samples do not establish a startup improvement; the measured startup medians increased and varied substantially between processes.
These are three process-level trials per variant, not 15 independent machine environments or portable guarantees.

The workload deliberately leaves quiet/verification intervals between edits, providing time to prepare a worker.
It establishes benefits for idle-separated edits, not sustained bursts or edits arriving before readiness.
The cold control characterizes the no-prepared-worker path; a partially warmed worker can still require a readiness wait.
There is no claim that every edit saves approximately 85 ms.

One prewarmed sample in round 2 produced two builds and settled in 525.40 ms.
It remains in the all-edit statistics; every other measured edit and all timing-run warm-ups produced one build.
No stabilization was enabled, and this sample does not establish a change in duplicate-notification frequency.
All 45 measured edits and nine warm-ups passed HTML, exact raw Markdown, search, LLM-pack, and untouched-sibling-output checks.

## Separate resource and work measurements

Parent-only instrumentation wrapped page-worker creation and dispatch in three additional fresh processes per variant.
Each ran an initial build, one warm-up, and two further edits, all with successful output assertions.
The profiler did not install inherited `--import` hooks, which would correctly disable speculative warming.
Its timings are separate from the latency table above.

| Observation | Cold protocol | Prewarmed |
| --- | ---: | ---: |
| Idle page workers per checkpoint | 0 | 1 |
| Observed maximum simultaneous page workers | 1 | 1 |
| Page workers remaining after stop | 0 | 0 |
| Workers created per four-build session | 4 | 5 |
| Median worker construction-to-ready | 100.01 ms | 96.06 ms |
| Median synchronous parent `postMessage()` duration | 4.25 ms | 4.12 ms |
| Median result-receipt-to-parent-exit event | 2.77 ms | 3.03 ms |

The original runtime also had zero idle workers, a maximum of one observed page worker, and four created workers per four-build session.
Each warm session used one initial cold worker and three warmed workers, then prepared one final worker that was never used.
Prewarming moves work off the edit's critical path; it does not remove that work, and the unused worker is genuinely additional work.
The dispatch measurement covers the sender's synchronous call, not receiver deserialization or end-to-end IPC.

Across nine post-edit idle checkpoints, the speculative worker had:

- **19.27 MiB median V8 used heap**, range 19.266–19.323 MiB.
- **31.84 MiB median V8 total heap**, range 31.344–32.594 MiB.
- **94.45 ms median worker-thread CPU at speculative readiness**, range 90.264–106.382 ms across twelve readiness samples completed before dispatch.
- **0.032 ms median additional worker CPU during a 200 ms idle interval**, range 0.022–0.035 ms.

These are observed, non-forced-GC heap snapshots, not a hard memory bound, post-GC retained size, or exclusive RSS.
Native/external memory and the thread itself add costs beyond V8 used heap.
Multiple simultaneous watch sessions can each own their own idle worker.

Process-wide peak RSS medians were 911.75 MiB before, 846.58 MiB for the cold protocol, and 896.58 MiB with warming.
Natural post-edit RSS varied widely in all variants, so those values cannot isolate the worker's incremental resident-memory cost or establish a memory reduction.
They include the full initial build, driver allocations, parent runtime, esbuild, and all workers.
The directly sampled idle-worker heap is the more specific resource observation.

### Shutdown investigation

Resource profiles initially showed approximately 5.3 seconds between requesting termination of the final idle worker and receiving its exit event.
That interval includes parent event delivery, not just worker termination.
A separate full-Oro measurement without native heap/CPU probes recorded:

| Variant | `stopWatching()` duration | Maximum parent heartbeat gap |
| --- | ---: | ---: |
| Before | 5.252 s | 5.210 s |
| Cold protocol | 5.341 s | 5.250 s |
| Prewarmed | 5.328 s | 5.236 s |

An isolated 15-process experiment measured approximately 1.66–2.35 ms pool-close time across no-probe, CPU-probe, heap-probe, repeated-probe, and pending-probe cases.
All 47 native probe calls completed, with no timeout or error.
Together these results show that the five-second parent-observed gap is not evidence of a new prewarming/native-probe penalty: a comparable parent stall already occurs with the baseline.
The underlying cleanup operation was not identified or changed, and one full shutdown measurement per variant does not establish statistical equivalence.
All owners were drained at completed shutdown.

## Regression coverage and validation

`lib/build-pages/worker/page-worker-pool.test.js` adds 56 tests/subtests covering readiness, one-job execution, premature exits, malformed protocol, cloning, retirement, speculative failures, context changes, preload/loader bypass, preserved cold hooks, fresh transitive imports, and partial-output recovery.
`lib/watch/lifecycle-tests/prewarmed-workers.test.js` adds nine real-integration tests covering startup, queued drains, idle preparation, active-build/structural shutdown, pending retirement, restart isolation, independent sessions, and callback-requested stop.

Existing Markdown preparation tests now observe the explicit dispatch message instead of the former `workerData` payload, preserving their cache/reset/read assertions.
Two timing-sensitive test adjustments were justified by reproduced filesystem behavior:

- The collision-recovery test's next write could fall inside Chokidar's existing 50 ms same-path throttle after a fast failed build; a documented 100 ms separation retains real event delivery and all assertions.
- The two order-sensitive competing-output tests now deliver one source event per intentional edit while retaining real watcher readiness/membership/cleanup and real builds; traces had shown a delayed duplicate owner event overwriting the competing output before assertions.

These are test controls, not production debounce or stabilization changes.
The corrected collision case passed ten consecutive runs; the competing-output pair passed 40 repeated concurrent runs, covering 80 executions.

Final validation:

- Full `node --test --test-reporter=spec`: **815 passed, 2 existing TODOs, no failures**.
- Full `npm run test:neostandard` and `npm run test:tsc`: passed.
- Independent runtime and measurement review: no remaining blocker identified.
- All latency, resource, and separate shutdown driver output assertions passed.
- Tool syntax, relative documentation links, and diff whitespace checks passed.

The full suite initially exposed the old transport probe and both filesystem timing assumptions; those failures are retained in separately named logs rather than presented as passing runs.
The existing #328 analyzer limitations and the layout-chain/stabilization deferrals are unchanged.
No broader Oro browser/content audit was rerun for this worker-lifecycle change.

## Evidence and decision

Ship single-use prewarming for eligible watch sessions: the measured idle-separated edit improvement is material, worker count is bounded by session ownership, and the resource/cold-path tradeoffs are explicit.
Keep application execution single-use and bypass warming for inherited loading hooks.
Do not extend this into persistent application workers or eager application imports.

Ignored Oro evidence includes `domstack-prewarm-{before,cold,warm}-{1,2,3}-driver.json`, separate `domstack-prewarm-profile-*` JSONL/driver reports, `domstack-shutdown-*` reports, and `domstack-prewarm-runtime-audit.json`.
Local runners are `test-results/run-domstack-prewarm.py` and `test-results/run-domstack-shutdown.py`; they refuse to overwrite existing evidence and restore the original package in `finally` blocks.
Local tools are `tools/profile-domstack-workers.mjs` and `tools/measure-domstack-shutdown.mjs`.
DOMStack evidence includes `test-results/prewarmed-workers-full-tests-verified.log` and the `phase6b-native-probe-*` isolation artifacts.

Oro's installed beta.8 package was restored after every run, and its tracked tree remained unchanged.
No application source, original output, manifest, or lockfile was changed, and no Oro commit or push was made.
This completes the planned core optimization experiments; HTML preparation caching and further lazy initialization remain optional, separately measured follow-ups.
