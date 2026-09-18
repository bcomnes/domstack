# Issue 334: Markdown cache transport and memory

This follows the [Oro validation](334-oro-validation.md) and closes the first resource-profiling pass for the [optimization plan](334-watch-preparation-performance.md).
No production runtime changes or commits were made during this profiling step.
Oro's original installed beta.8 package was restored after every candidate run.

## Scope and protocol

The machine, Node v26.8.2, source fixture, body edit, and output assertions match the preceding Oro validation.
The candidate is the same working runtime snapshot with all 38 direct dependencies matched to Oro's installed baseline.
The snapshot's runtime sources were checked against the working checkout before profiling.

Three separate experiments prevent instrumentation from being mistaken for an end-to-end latency result:

1. Capture one actual candidate edit's `workerData`, then compare that payload with and without `opts.previousMarkdownPreparation` in an isolated transport probe.
2. Run three fresh Node processes per implementation with explicit major-GC checkpoints, including one startup, one warm-up, and five measured edits per process.
3. Run three more fresh processes per implementation without hooks, GC flags, or payload capture, under macOS `/usr/bin/time -l` for process-lifetime peak RSS.

Implementation order is baseline/candidate, candidate/baseline, baseline/candidate for both site experiments.
All runs are serial.
The independent process-level sample size is three per implementation, not fifteen independent edit workloads.
The timings from the forced-GC/capture runs must not replace the original uninstrumented latency table.

## Actual-payload transport

The private capture contains 605 source pages and 585 prepared Markdown entries, as well as the existing producer/dependency/output state normally sent to a page worker.
Serialized proxy sizes were approximately 19.34 MiB for the complete input and 12.75 MiB with only the preparation cache omitted.
The cache alone was 6.59 MiB.
These `node:v8.serialize` sizes are not wire-byte measurements.

The standalone probe ran in three fresh processes, each with five excluded warm-up pairs and 30 measured pairs per transport mode.
Full/cache-omitted order alternates within each mode.
Every copied payload is verified for page counts, cache shape, body totals, and graph content outside the receipt timestamp.

| Measurement | First run: full | First run: cache omitted | Range of paired median cache overhead across three runs |
| --- | ---: | ---: | ---: |
| Complete local `structuredClone()` | 8.23 ms | 5.92 ms | 2.04–2.30 ms |
| Synchronous `new Worker()` call with `workerData` | 4.15 ms | 3.07 ms | 1.09–1.25 ms |
| Dispatch to first worker module-body timestamp | 33.73 ms | 29.55 ms | 3.93–4.17 ms |
| Synchronous `postMessage()` to a ready worker | 3.93 ms | 2.83 ms | 1.07–1.12 ms |
| Send to ready worker's message callback | 12.38 ms | 8.61 ms | 3.33–3.53 ms |

Paired medians need not equal the difference between the two individual medians.
Local `structuredClone()` measures the complete synchronous clone but is not the worker transport path.
Worker construction includes sender serialization and startup initiation; dispatch-to-module-body additionally includes scheduling, input deserialization, and module loading.
The ready-worker path excludes startup but still includes scheduling and deserialization, not an isolated receiver-clone duration.
Acknowledgment timing is retained in the evidence but is deliberately not used above because it also includes expensive integrity validation.
No worker executes DOMStack or application code in this standalone experiment.
The source-cache transport penalty is a few milliseconds here, not a reason to discard the previously measured roughly 190 ms combined Markdown improvement.
That comparison is contextual, not a subtraction of unrelated timings into a new speedup claim.

## Retained cache memory

Before the transport loops, the probe clones only the preparation Map, keeps it explicitly rooted across three forced GCs, verifies it, then releases it and collects again.
The original captured payload remains live throughout.

All three processes measured approximately **6.70 MiB** additional parent-isolate `heapUsed` for the retained cache clone.
After release, the remaining difference from the pre-clone heap was **1,128 bytes** in each process.
External-memory changes were negligible.
RSS did not return to its original value immediately; freeing JavaScript objects does not guarantee that the allocator returns memory to the OS.
This isolates the cost of a cloned cache graph, not every allocation associated with building or transporting the cache.

## Live site heaps with controlled GC

The resource preload instruments exact page-worker source anchors using module-load hooks, without modifying runtime files.
Two completed asynchronous major GCs with intervening event-loop turns precede each checkpoint.
Parent checkpoints wait for all dispatched page workers to exit.
Worker checkpoints keep input and output results live, as required for the real build protocol.

| Post-GC heap measurement | beta.8 | Candidate |
| --- | ---: | ---: |
| Median parent heap after measured edits | 53.84 MiB | 60.58 MiB |
| Median worker heap before measured builds | 31.52 MiB | 38.37 MiB |
| Median worker heap after measured builds, result still live | 55.22 MiB | 61.50 MiB |
| Median parent heap after watcher shutdown | 36.43 MiB | 36.48 MiB |

The approximately 6.7 MiB parent difference agrees with the isolated retained-cache probe.
The near-equal stopped parent heaps support session cleanup releasing this cache in the tested workload.
They are not a proof that arbitrary workloads cannot leak.
Parent measurements include the harness's retained events, snapshots, and sample records, not only DOMStack ownership.
Worker measurements include imported modules, the original worker input, and the result graph; subtracting the before/after heaps does not measure total allocations.
All 30 measured edits and all six warm-ups in this forced-GC experiment produced one build and passed output assertions.

## Observed peaks and their limits

Five-millisecond worker-isolate sampling during measured build bodies observed maxima of 115.28–166.19 MiB for beta.8 and 113.65–156.08 MiB for the candidate.
These are lower bounds: a blocked event loop can hide transient peaks, and this window excludes input loading/deserialization and output transport.
They do not establish that the candidate reduces peak worker heap.

Process high-water RSS through the final forced-GC checkpoint ranged from 853.67–916.06 MiB for beta.8 and 913.95–963.38 MiB for the candidate.
Forced GC changes allocation behavior, so a separate uninstrumented experiment measured full process-lifetime peaks:

| Fresh-process pair | beta.8 peak RSS | Candidate peak RSS | Candidate extra builds |
| --- | ---: | ---: | --- |
| 1 | 865.39 MiB | 936.20 MiB | None |
| 2 | 916.73 MiB | 1,012.41 MiB | One warm-up produced two builds |
| 3 | 862.36 MiB | 1,192.98 MiB | One warm-up and three measured edits produced two builds each |

These high-water marks include initial builds, all edits, every Node worker, and harness work; they exclude separate esbuild subprocesses.
They are not cache-only memory costs or per-edit peaks.
The last two candidate runs performed more builds than the corresponding baseline, so their RSS differences are not an equal-work comparison.
Even the equal-build-count first pair is only one process pair and does not establish a stable memory budget.
The observations warrant attention but do not establish a leak or attribute the process RSS increase solely to the cache.

## Duplicate-build follow-up

Unlike the earlier uninstrumented latency runs, the later peak-RSS experiment observed duplicate builds without profiling hooks or forced GC.
Every duplicated sample recorded two `page.md changed` log messages and two successful builds for one harness write.
The second build rewrote the page without rebuilding the already-current search and LLM templates.
All output assertions still passed, including exact raw Markdown and unchanged sibling outputs.

The candidate had three multi-build measured edits out of fifteen in this later experiment, plus two multi-build warm-ups.
The baseline had none in these three runs, although the original issue reported the behavior on beta.8.
This does not establish the cause or rule out an optimization-sensitive scheduling regression.
A separate intrusive capture run also produced two builds; it is not needed as evidence now that an uninstrumented observation exists.

The runner initially asserted one build per measured edit and therefore reported a validation assertion on the last uninstrumented candidate run, despite successful application/output checks.
The evidence was retained rather than discarded or rerun until clean, and the runner now records the classification instead of rejecting multi-build samples.
A previous capture-run count assertion failed for the same reason.
The original installed package was restored in both cases.

The subsequent [duplicate-build investigation](334-duplicate-build-investigation.md) traces event provenance and batch boundaries and reproduces delayed truncate/write notifications on both implementations.
It also tests write stabilization without changing production defaults.
The resource-run logs alone do not establish the underlying OS event sequence or the cause of each earlier duplicate.

## Tools, evidence, and validation

New local tools in Oro:

- `tools/profile-domstack-resources.mjs`: opt-in main/worker instrumentation and GC checkpoints.
- `tools/measure-domstack-cache-ipc.mjs`: standalone paired clone/transport and retained-cache probe.
- `tools/benchmark-domstack-watch.ts`: optional resource checkpoints; normal runs retain their original timing protocol.

Evidence remains ignored under `oro-website/test-results/`:

- `domstack-resources-worker-input.bin`: private source-bearing V8 capture; do not commit or upload it.
- `domstack-resources-ipc.json`, `domstack-resources-ipc-2.json`, and `domstack-resources-ipc-3.json`.
- `domstack-resources-{beta8,candidate}-{1,2,3}.jsonl` and corresponding driver reports.
- `domstack-resources-natural-{beta8,candidate}-{1,2,3}-{driver.json,stderr.txt}`.
- Capture/smoke records and `run-domstack-resources.py`, the local link/restore orchestrator.

The standalone probe validates every received graph and fails on worker errors, premature exits, or timeouts.
The forced-GC runner verifies matching dispatch/completion/successful-exit counts and zero build errors.
All 60 measured edits across the forced-GC and natural-memory site experiments passed output checks, including multi-build samples.
Syntax checks and Oro type checking passed after the tooling changes.
No runtime code changed, so the earlier complete DOMStack suite and Oro browser/content validation were not rerun in this profiling step.
