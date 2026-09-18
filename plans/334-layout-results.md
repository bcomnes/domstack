# Issue 334: layout-stage measurement and reuse decision

Phase 6A of the [watch-performance plan](334-watch-preparation-performance.md) is measured and **deferred without runtime changes**.
The current runtime remains checkpoint `e30f3a8`, including phases 1–5.
Repeated chain traversal is real work, but is too small in the Oro workload to justify mutation-sensitive caching.
The next independent experiment is phase 6B, prewarmed single-use workers.

## What currently happens

`lib/build-pages/build.js` imports and resolves every discovered layout, including its vars export, before initializing pages.
It validates each discovered layout's ancestry once, then each `PageData.init()` resolves its selected ancestry again.
The output filter is applied after all concrete source pages have been initialized.

`lib/build-pages/layouts/resolve-layout.js` separates naturally into module import, export validation, and `resolveVarsExport()`.
`lib/build-pages/layouts/resolve-layout-chain.js` follows `parentLayout` links synchronously and returns a fresh outermost-to-innermost array.
Caching those arrays would not avoid imports, layout-vars execution, per-page dependency extraction, subscriptions, vars merging, or asset preparation.

## Measurement protocol

The retained phase-5 package snapshot was linked temporarily into Oro, sharing Oro's installed dependencies.
All profiled source modules were checked byte-for-byte against the current DOMStack checkpoint.
Oro's original installed beta.8 package was restored with a backup and `finally`-guarded link cleanup after every run.
No application source, original `public/`, manifest, or lockfile was changed.

On Node v26.8.2, macOS arm64, three fresh processes each ran one watch session with an initial build, one excluded warm-up edit, and three further edits.
This yielded nine post-warm-up edit profiles, three separate warm-up profiles, and three initial-build profiles.
The source copies contained 605 concrete pages, including 585 Markdown pages, and seven discovered layouts.
The maximum layout-chain depth was two.

`oro-website/tools/profile-domstack-layouts.mjs` uses checked source anchors and worker-local loader hooks rather than editing runtime files on disk.
It records:

- Wall time around the full layout-loading `pMap`, ending before registry construction and chain validation.
- Start/end intervals around each awaited layout-module import.
- Start/end intervals around each awaited `resolveVarsExport()` call, including object/absent exports as well as functions.
- Synchronous chain-resolution counts and aggregate durations, separated into eager validation, concrete-page initialization, and downstream/generated initialization.
- Worker identity, input membership, reported output count, and errors.

For concurrent import/vars intervals, the summary uses the union of intervals rather than summing overlapping waits.
For each build, sort intervals by start and sum only the portion of each interval beyond the furthest end already covered.
Compute medians across the nine post-warm-up builds; do not pool all module waits or treat them as independent samples.
Every edit in these runs produced exactly one build, so records three through five in each JSONL file correspond to that run's three measured edits.
Future runs with multiple builds must use the driver's per-edit build counts for attribution rather than assuming those positions.

## Results

| Stage or work count | Median per post-warm-up edit | Range across nine edits |
| --- | ---: | ---: |
| Full layout-loading stage | 52.065 ms | 49.184–57.398 ms |
| Union of outstanding import-await intervals | 51.800 ms | 48.916–57.068 ms |
| Union of layout-vars resolution intervals | 0.110 ms | 0.094–0.122 ms |
| Seven eager chain validations | 0.045 ms | 0.042–0.056 ms |
| 605 concrete-page chain resolutions | 0.369 ms | 0.356–0.406 ms |
| Downstream/generated chain resolutions | 0 calls | 0 calls |

All seven layouts were imported and their vars resolved on every build.
Of the 605 concrete pages, 584 selected `docs`, 12 selected `learn`, five selected `product`, three selected `marketing`, and one selected `spec`.
Each post-warm-up build reported one output page, despite preparing all concrete pages.

Initial layout-loading time was 77.169–163.872 ms across the three fresh processes, with an 87.906 ms median.
Initial concrete-chain resolution was 0.580–0.674 ms, with a 0.584 ms median.
Initial builds also performed two downstream/generated chain resolutions, taking approximately 0.005 ms in aggregate.
Warm-up profiles are retained separately and excluded from the nine-edit table.

### Interpretation limits

Import intervals measure outstanding awaits, not exclusive module-loading CPU or evaluation time.
An outstanding import can overlap another module's vars execution or other event-loop work.
Do not add import-union and vars-union medians as independent components or subtract them to derive exact residual overhead.
The loading stage is largely covered by outstanding imports; that is sufficient to distinguish it from the much smaller chain traversal stage.

The chain timer includes instrumentation overhead and closure invocation, and wrapping can affect JIT behavior.
Some allocation costs can appear later through garbage collection.
These values are neither exact net savings from a hypothetical cache nor a strict upper bound.
A correct cache would still allocate page-owned arrays and retain eager validation.

No uninstrumented before/after latency comparison was run because no runtime optimization was implemented.
The driver's edit-latency fields include profiling overhead and must not be compared with earlier uninstrumented benchmark medians.
Its `resourceProfileOnly` field recognizes the separate resource profiler, not this layout profiler; the recorded `execArgv` identifies these instrumented runs.
These shallow-chain, mostly concrete-page observations do not rule out benefits for another site with deep hierarchies or many generated pages.

## Why not retain the validation results now?

Each page currently receives an independent chain array containing references to shared mutable layout records.
Returning one cached array to several pages would introduce new coupling through array mutation.
Copying the array avoids that particular problem, but does not handle later changes to the shared records' `parentLayout` links.

The build exposes concrete `PageData` instances to `global.data` before generated pages are initialized.
Global-data code can mutate their shared layout records, and generated-page factories can retain those references and mutate them between yielded definitions.
Generated pages are initialized and written incrementally, not all at once immediately after global data.
Layout render functions are called as record methods, so an ordinary function can also mutate `this.parentLayout` during rendering.
Current later chain resolution observes those changes and can reject newly missing parents or cycles.
An unconditional build-wide cache could silently use stale ancestry instead.

A narrower concrete-initialization-only cache could avoid the normal downstream mutation boundary, while generated pages and direct `PageData` callers continue resolving afresh.
Whole-build reuse would require mutation-aware checks, or a separately approved immutability contract.
Neither additional mechanism is justified by the approximately 0.37 ms observed concrete traversal cost here.

If revisited, preserve all-layout import/export/ancestry validation, including unused layouts, independent page arrays, shared record identity, direct-call mutation semantics, and fresh application execution across workers.
Do not extend caching to vars, subscriptions, or assets without separate semantics and measurements.
Within-build reparenting, changes between generated yields, array ownership, unused invalid layouts, and direct-call registry changes would require focused regression coverage.

## Validation and evidence

All twelve edit samples, including warm-ups, produced a single build and passed the existing driver's checks for:

- Updated HTML with current markers and no stale markers.
- Exact raw Markdown bytes.
- Correct search entry and LLM-pack content/source URL.
- Exactly the expected HTML/raw sidecar rewrites, with sibling outputs untouched.

All fifteen worker profiles reported zero errors and the expected import/vars counts.
Profiler syntax checking passed, and independent read-only review confirmed the measurement boundaries and deferral conclusion.
The DOMStack suite was not rerun for this documentation-only decision; its last runtime checkpoint passed 750 tests with two existing TODOs, lint, and type checking.
Oro's original package was restored and its tracked tree remained unchanged.
No Oro commit or push was made.

Local tooling is `oro-website/tools/profile-domstack-layouts.mjs` and ignored `oro-website/test-results/run-domstack-layout.py`.
Ignored evidence is `domstack-layout-profile-{1,2,3}.jsonl` and the matching `-driver.json` files under Oro's `test-results/`.
The runner uses the retained `domstack-dependency-candidate` snapshot and refuses to overwrite existing evidence.
With fresh evidence paths, reproduce the three sessions using `python3 test-results/run-domstack-layout.py --run 1`, then runs 2 and 3.

## Next step

Evaluate prewarming a single-use worker that loads only DOMStack's internal runtime before accepting one build request.
Application imports must still begin after the request, so that experiment does not remove the roughly 52 ms layout-loading stage identified here.
Measure its own latency, memory, idle work, and shutdown tradeoffs before deciding whether to ship it.
