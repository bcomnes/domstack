# Issue 334: dependency-analysis reuse results

Phase 5 of the [watch-performance plan](334-watch-preparation-performance.md) is implemented on `perf/334-markdown-preparation`.
This checkpoint reuses eligible import-analysis results without retaining live pages, application modules, or routing objects across builds.
Source-write stabilization remains deferred; `atomic: 300` is unchanged and `awaitWriteFinish` remains disabled.

## Implementation

`lib/watch/dependency-index.js` separates retained successful analysis from routing maps reconstructed on every accepted page build.
Each absolute root retains its own analyzer-returned dependency list; the existing per-build promise map still deduplicates roots shared by several roles, including failed attempts.
Routing always uses current discovery objects and the last successful layout selections, so Markdown frontmatter changes can move a page between layouts without reanalyzing unchanged imports.

Reuse is explicitly opted into by the watch coordinator for eligible filtered builds.
Bare `rebuild(siteData)` callers still analyze afresh and cannot seed retention without an observation predicate.
Initial, full, and recovery passes analyze afresh, but successful passes with reliable observation can seed later reuse.
The replacement cache contains only roots queried during the current pass, including successful empty results.
No file hashes, size/mtime assumptions, shared transitive visited set, or new application API are introduced.

### Observation and invalidation

`lib/watch/index.js` records every delivered source event before routing filters or skipped page-build decisions.

- A changed root or reported transitive dependency evicts every affected retained closure.
- Structural events and uncertain inputs clear retained analysis conservatively.
- Known direct Markdown/HTML page edits can retain unrelated analysis, while routing is still reconstructed.
- Browser-only events invalidate retained analysis even when the page phase is skipped.
- Full builds, prior server analysis failures, changed working directories, and changed observation context require fresh analysis.
- Analysis failures are not retained; browser-only failures preserve the existing role-specific recovery policy.

Retention requires every reported path, including the root, to be inside the source tree, eligible under the actual watcher's ignore policy, present in Chokidar's `getWatched()` membership, and identical to its canonical `realpath()`.
External, ignored, missing, and symlink-alias paths therefore cannot authorize retention.
The membership snapshot is constructed lazily once per analysis pass and discarded afterward; a fully warm pass needs neither a membership snapshot nor realpath checks.

Independent review caught an important distinction between a file matching the ignore policy and its parent directory actually being traversed.
The final membership check covers parent exclusions and Chokidar's built-in atomic-save exclusions, including directories ending in `~`.
Regression tests change import edges under those unobserved directories without delivering a helper event, then verify fresh analysis and routing on the next Markdown build.

Watcher errors permanently disable retention for that session rather than assuming one successful analysis restores missing event history.
Stopping disables observation and clears analysis both before and after draining active work.
Epoch and generation guards prevent an event, clear, working-directory change, or superseding rebuild from publishing stale retained analysis.
An event or working-directory change during analysis also marks routing uncertain, preserving conservative subsequent handling.

### Analyzer limitations remain

This optimization preserves the installed analyzer's supported dependency model; it does not make that model complete.
The installed `@11ty/dependency-tree-esm` implementation follows supported top-level relative/file import declarations, not every Node or esbuild resolution path.
Static re-exports and bare imports are not tracked by that implementation, and missing inputs can produce empty results rather than errors.
[Issue #328](https://github.com/bcomnes/domstack/issues/328) remains unresolved, and its two existing TODO tests remain visible.
Checking observation of reported paths cannot discover paths the analyzer omitted.
Unknown-event invalidation is a conservative fallback, not a fix for incomplete analysis, especially when an omitted helper is already known through another role.

## Regression coverage and validation

`lib/watch/dependency-analysis.test.js` adds 17 tests covering:

- Fresh-by-default behavior, explicit observation, predicate identity, and fresh-pass seeding.
- Complete reported-path eligibility, rejected observation checks, and per-role promise deduplication.
- Root/transitive invalidation, browser-only skipped work, unknown/structural events, and Markdown/HTML exceptions.
- Membership pruning, empty-result replacement, fresh discovery identities, layout routing, and previous-snapshot preservation.
- Server/browser failure and retry policies, event/clear races, and overlapping rebuild publication.
- Working-directory changes between and during passes, absolute-path recovery, and subsequent reuse.

`lib/watch/dependency-analysis-watch.test.js` adds 13 passing tests/subtests using real workers, discovery, analyzer reads, esbuild, output writes, and Chokidar traversal, with manually delivered source events for deterministic control.
Coverage includes zero analyzer reads on warm Markdown/HTML edits, frontmatter-selected layout changes, dirty events recorded before filtering, browser-only invalidation, fresh helper output, render failure recovery, sticky watcher-error distrust, startup failure, stop/restart, in-flight observation loss, and unobserved dependency closures.

Validation completed:

- Full `node --test --test-reporter=spec`: **750 passed, 2 existing TODOs, no failures**.
- Full `npm run test:neostandard` and `npm run test:tsc`: passed.
- Targeted unit/integration, nested-layout routing, and lifecycle tests: passed.
- Independent implementation review and follow-up observation-fix review: no remaining serious issues identified.
- Profiler syntax check and `git diff --check`: passed.

## Controlled Oro comparison

The before package includes phases 1–4, including the completed fingerprint optimization.
The after package differs only in `lib/watch/dependency-index.js` and `lib/watch/index.js`.
Both snapshots resolve the same installed Oro dependencies, so this comparison isolates dependency-analysis reuse rather than comparing against original beta.8.

Measurements used Node v26.8.2 on macOS arm64.
Three fresh processes per variant ran one watch session, one excluded but retained warm-up, and five measured edits of `src/runtime/docs/guides/hello-world/page.md`.
Pair order was before/after, after/before, before/after, with no concurrent tests or other benchmark commands.
The existing uninstrumented driver, in-place writes, output assertions, and 500 ms post-settlement drain checks were unchanged.

| Measurement | Before dependency reuse | With dependency reuse |
| --- | ---: | ---: |
| Measured edits | 15 | 15 |
| Median edit-to-settled, all measured edits | 332.67 ms | 314.75 ms |
| p95 edit-to-settled, all measured edits | 351.11 ms | 610.93 ms |
| Single-build measured edits | 15 | 14 |
| Median single-build edit-to-settled | 332.67 ms | 314.26 ms |
| p95 single-build edit-to-settled | 351.11 ms | 334.49 ms |
| Median initial watch startup | 5.737 s | 5.723 s |

Median latency across all measured edits decreased by **17.92 ms, approximately 5.4%**.
These are local sequential comparisons with alternating order, not randomized trials or portable guarantees.
The startup difference is too small to establish an improvement.

The candidate's first measured edit in pair 3 produced two builds and settled in 610.93 ms; all other measured edits and all timing-run warm-ups produced one build.
That sample remains included in the all-edit statistics and separately classified rather than discarded.
Its cause was not traced in this run, and these samples do not establish a change in duplicate-build frequency.
The [separate investigation](334-duplicate-build-investigation.md) documents a reproducible duplicate-notification mechanism in both original and optimized versions.
No stabilization was enabled to improve this comparison.

All 30 measured edits passed the HTML marker, exact raw Markdown, search entry, LLM-pack body/source URL, and untouched-sibling-output checks.
The six warm-ups and separate profiling edits also passed their output checks.
Original authored sources and `public/` were untouched; each session used a fresh disposable copy.

### Separate dependency profiling

`oro-website/tools/profile-domstack-dependencies.mjs` instruments dependency-index rebuilds in the parent process independently of the latency runs.
It counts actual root `find()` invocations, cache hits, retained entries, and rebuild duration without changing either snapshot on disk.
Each variant ran one initial build, one warm-up, and two further edits.

| Profiled work | Before | With reuse |
| --- | ---: | ---: |
| Initial analyzer calls | 52 | 52 |
| Initial dependency-index duration | 43.01 ms | 55.90 ms |
| Analyzer calls per subsequent edit | 52 | 0 |
| Reused roots per subsequent edit | 0 | 52 |
| Median index duration across three edits | 25.78 ms | 0.41 ms |

All 52 roots were eligible for retention in this Oro fixture; the analyzer returned nine dependency-list entries across those roots.
That small reported dependency count must not be interpreted as a complete application import graph, given the analyzer limitations above.
All profiled passes reported successful dependency analysis.
The initial candidate pass performs extra observation checks and cache population; the single profiled startup observation shows that cost rather than claiming a startup optimization.
The approximately 25.37 ms reduction in the profiled index stage is not an additive prediction for the separate uninstrumented edit timings.

## Repository state and reproduction

Oro's installed `@domstack/static@12.0.0-beta.8` directory was restored after every run using a backup and `finally`-guarded temporary link.
No Oro manifest, lockfile, authored source, or original output was changed, and no Oro commit was made.
Validation tooling and private package snapshots remain local and uncommitted in Oro.
The previous Oro browser/content audits were not rerun because this change affects dependency routing rather than rendering; real helper-change regressions and incremental output checks cover this phase directly.

Ignored DOMStack evidence is `test-results/dependency-analysis-full-tests.log`.
Ignored Oro evidence includes `domstack-dependency-{before,after}-{1,2,3}-driver.json`, `domstack-dependency-profile-{before,after}-1.jsonl`, the corresponding profile driver reports, and `run-domstack-dependency.py`.
The runner uses the retained `domstack-fingerprint-candidate` and `domstack-dependency-candidate` snapshots and refuses to overwrite existing reports.

With fresh evidence filenames, run the local runner for pairs 1, 2, and 3, followed by `--profile` for the separate counters.
The next independent workstream is phase 6A layout-chain measurement/reuse; phase 6B single-use worker prewarming remains a separately measured experiment.
Shared transitive parse reuse is deferred because warm eligible edits already avoid every analyzer call in this workload.
