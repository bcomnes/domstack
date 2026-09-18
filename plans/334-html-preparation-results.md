# Issue 334: HTML source-preparation investigation

HTML source caching is **investigated and deferred for the measured Oro workload**, without production runtime changes.
The runtime remains checkpoint `3447a95`, including selective default Markdown/Handlebars loading.
A local happy-path prototype eliminated every repeated HTML source read but did not demonstrate a consistent rebuild-latency improvement.
This completes the measurement gate for the optional HTML extension in the [watch-performance plan](334-watch-preparation-performance.md), not its implementation.

## Current work and safe cache boundary

`lib/build-pages/page-builders/html/index.js` reads the source once as UTF-8 during preparation, returns fresh empty builder vars, and captures the string in a renderer closure.
It does not parse HTML, infer titles, or compile templates at that point.
Handlebars is checked and, when enabled, compiled on every render using the captured source and current inputs.
`PageData.init()` retains this renderer for the current page instance, so repeated rendering within one build already avoids repeated source reads.

`lib/build-pages/build.js` initializes every concrete page before global-data execution and output selection.
Consequently, a Markdown-only edit still reads each HTML source in the fresh page worker even when no HTML source page is rendered.
Caching HTML would avoid reading and decoding those strings, not layout imports, companion vars, Handlebars compilation, output formatting, or output writes.

A safe cache would retain only `{ sourceId, source }` records, keyed by normalized absolute source path and bounded by current nongenerated HTML membership.
The immutable source strings do not need Markdown's mutable-frontmatter clone-fidelity machinery.
The builder must still create fresh vars and runtime closures and observe current render inputs.

Simply moving the read into rendering is not equivalent.
Currently, a missing or unreadable HTML source fails initialization even when excluded from outputs, before the global-data producer runs.
Deferral could hide that error, move it after producer side effects or other output writes, capture a later filesystem state, and introduce an asynchronous boundary before interpolation.
HTML syntax is not validated during preparation; malformed Handlebars already fails only on enabled renders.

## Workload and separate profiling

Normal discovery finds 605 concrete Oro pages: 585 Markdown and **20 HTML**, with no concrete JavaScript pages.
The HTML sources contain **102,824 UTF-8 bytes** in total, approximately 100.4 KiB.
All measurements used Node v26.8.2 on macOS arm64 with an Apple M1 Max.

Three fresh profiling processes each performed an initial build, one excluded warm-up edit, and three measured Markdown edits using the existing isolated-source watch driver.
Worker-local loader hooks instrumented the exact HTML read site, concrete-page initialization, HTML render calls, and worker completion without rewriting runtime files on disk.
All 81 runtime JavaScript files covered by the audit matched the current DOMStack checkout and the dependency-matched package snapshot before profiling and again after all experiments.
Tests and fixture trees were excluded from that runtime audit.

| Measurement | Median across nine measured rebuilds | Range |
| --- | ---: | ---: |
| HTML source reads | 20 | 20–20 |
| HTML source bytes read | 102,824 | 102,824–102,824 |
| Union of outstanding HTML read intervals | 28.227 ms | 27.934–32.179 ms |
| Concrete-page initialization, all page types | 34.671 ms | 33.232–38.411 ms |
| HTML source-page render calls | 0 | 0–0 |
| Hypothetical source map, V8 serialization-size proxy | 117,855 bytes | 117,855–117,855 bytes |

Initial builds read the same 20 files and render all 20 HTML pages, with zero enabled Handlebars renders.
Their read-interval union was 25.868–29.343 ms, within a 157.455–211.325 ms concrete-initialization stage.
The full initial page report includes 607 page entries, including generated pages; measured edit reports contain one page entry.
These are page-report counts, not total output-file counts.

All twelve edit samples, including warm-ups, passed the driver's output checks.
The third profiling session's warm-up produced two builds; both are excluded from the nine measured builds using the driver's per-edit build counts.
All measured edits were single-build, and all sixteen worker profiles reported zero errors.

### Why pending reads are not predicted savings

The interval begins when the read is issued and ends when its awaited continuation resumes.
It includes scheduling delays and concurrent application initialization, not just filesystem service time or decoding CPU.
Taking the union avoids double-counting overlapping reads but still does not identify removable critical-path time.
Do not subtract 28 ms from rebuild latency or interpret the larger sum of per-read intervals as a potential saving.

Profiling adds wrappers and retains source strings for size measurement.
Although per-source sizing occurs after that source's read timer, it can affect other outstanding intervals and overall initialization.
The V8 serialization-size proxy is neither actual Worker transport bytes nor retained heap usage or transfer time.
No end-to-end speedup is inferred from these profiling values.

## Local read-elision experiment

The local `oro-website/tools/experiment-domstack-html-cache.mjs` preload compares read-through and cached variants of the same runtime snapshot and dependencies.
Both variants use loader-hook wrappers, payload handling, and counters; these are **hook-enabled timings**, not an untouched-production baseline or the preceding timing-instrumented profile.
The cached variant captures strings in the initial worker, returns source upserts to the parent, and includes retained source records in each subsequent fresh worker's real `workerData` payload.
The parent construction, string transfer, and lookup costs therefore occur inside the normal build path rather than being simulated as free reads.
No prewarming or retained application worker is used.

This is deliberately only a successful-build, fixed-membership investigation prototype.
It accepts candidate data after page-worker success rather than after full watch reconciliation and dependency rebuilding.
Its exceptional worker-report path does not preserve normal production error handling.
It is not eligible to ship and is not committed to DOMStack or Oro.

Three rounds ran five measured edits plus one excluded warm-up per variant, each in a fresh process.
Orders were read-through/cached, cached/read-through, then read-through/cached.
Counters verified 20 initial reads in both modes, then 20 reads per read-through rebuild versus **zero reads and 20 hits** per cached rebuild, with no source upserts on those edits.

| Round | Read-through median edit-to-settled | Cached median edit-to-settled | Cached minus read-through |
| --- | ---: | ---: | ---: |
| 1 | 319.641 ms | 361.194 ms | +41.553 ms |
| 2 | 327.889 ms | 322.003 ms | −5.886 ms |
| 3 | 328.420 ms | 348.327 ms | +19.906 ms |

Across the fifteen measured edits per variant, pooled medians were 326.173 ms read-through and 348.327 ms cached.
Nearest-rank p95 was 350.923 ms and 387.424 ms respectively; with fifteen samples, these are the maximum samples.
Initial-build medians across three processes were 6629.342 ms read-through and 6824.899 ms cached, with ranges of 6545.943–6782.647 ms and 6325.343–6870.557 ms respectively.

There is no consistent latency benefit despite complete read elision.
The cached variant was slower in both rounds where it ran second and faster where it ran first, leaving an unresolved order/time confound.
Five edits within a session are correlated, and the driver's 10 ms marker polling limits fine-grained interpretation.
These samples do not establish the cause of the observed slowdowns or prove a correctly integrated cache can never help.
Do not compare these hook-enabled values directly with earlier uninstrumented results.

All thirty measured edits and six warm-ups passed the existing driver's checks for current HTML markers, exact raw Markdown, search/LLM content, rewrite scope, stale-marker absence, and untouched sibling outputs.
Every measured edit produced one build; the cached third-round warm-up produced two, both excluded.
All forty-three experiment worker records reported zero errors, and every disposable site was removed normally.

These checks validate the tested Markdown-edit workload, not a complete HTML cache contract.
No measured edit renders an HTML source page, so correct output from a cached HTML rerender, HTML invalidation, membership transitions, resets, failure recovery, and lifecycle handling remain unvalidated by this experiment.
The experiment runner did not record a per-run runtime hash audit; the shared snapshot was verified unchanged before profiling and after all experiments.

## Isolated warm-read scale check

To separate source-read work from the concurrent application workload, three fresh processes ran 100 measured batches and five excluded warm-ups through the existing `htmlBuilder` for all twenty original HTML files.
Concurrency was ten, matching `Math.min(cpus().length, 24)` on this machine.
Every returned renderer was checked against the original captured source outside the timed region.
An alternating, separate synchronous `structuredClone()` operation checked the corresponding source map without claiming to reproduce Worker transfer.

| Isolated operation | Median range across three processes |
| --- | ---: |
| Prepare all 20 HTML pages with warm filesystem reads | 0.237–0.257 ms |
| Synchronously clone the 20-entry source map | 0.031–0.035 ms |

This is a same-process, warm-filesystem scale check without concurrent application initialization, not a cache speedup benchmark.
Setup, discovery, imports, assertions, and rendering were excluded.
Its original-path source map serializes to 117,155 bytes; shorter path keys explain the difference from the disposable-site profile's 117,855-byte proxy.
Neither the isolated timings nor their difference predicts end-to-end savings, but they reinforce that the 28 ms pending-read union is not isolated I/O cost.

## Decision and requirements if revisited

Defer production HTML source caching for this workload because the avoided work is small in isolation and the actual read-elision experiment does not demonstrate a consistent benefit.
Revisit for an HTML-heavy site, substantially larger sources, or slower storage with a controlled benchmark showing a worthwhile end-to-end improvement.
The absence of parsing makes the value proposition different from the implemented Markdown preparation cache.

If justified later, use the existing Markdown cache's lifecycle rather than creating a second invalidation policy:

1. Inject an internal HTML preparation resolver through `outputs/page-writer.js` and `page-builders/html/index.js`, leaving standalone/non-watch reads fresh.
2. Construct build-local candidates using complete membership in `build.js`, with event/upsert invalidation and conservative resets independent of output filters.
3. Add explicit cloneable state/update types and worker-option transport in `worker/protocol.js`, `worker/index.js`, and `build-pages/index.js`.
4. Keep retained state session-owned in `watch/index.js`, remove private cache metadata from public reports, and accept candidates only after total build/reconciliation/dependency-analysis success.
5. Preserve eager cold/invalidated read errors, source snapshots, fresh vars/layouts/companions, per-render Handlebars behavior, and fresh application modules.
6. Test empty-string hits, deduplicated reads and retry, path identity, add/remove/rename/type changes, reset/recovery, queued edits, cleanup failures, metadata-only builds, HTML rerenders, and stop/restart isolation.

Like the Markdown cache, this would be event-trusted reuse rather than fresh filesystem validation on every hit.
Do not cache live pages, compiled templates, merged variables, or rendered output.

## Validation, evidence, and checkpoint

The three new local tools pass `node --check` and completed their bounded runs without timeout.
The existing focused HTML/Markdown renderer and watch-snapshot regression selection passed all 18 tests:

```sh
node --test lib/build-pages/page-builders/lazy-handlebars.test.js \
  lib/build-pages/page/page-data-renderer.test.js \
  lib/watch/prepared-renderers.test.js
```

No runtime or test implementation changed, so the full suite was not rerun for this documentation checkpoint.
The prior runtime checkpoint passed 780 tests with two existing TODOs, lint, and type checking.
Independent read-only review recomputed the profile summary, checked experiment counters and output reports, and agreed with deferral and the stated attribution limits.

Local tools remain untracked in Oro: `tools/profile-domstack-html.mjs`, `tools/experiment-domstack-html-cache.mjs`, and `tools/measure-domstack-html-reads.mjs`.
Ignored runners are `test-results/run-domstack-html.py` and `test-results/run-domstack-html-experiment.py`.
Ignored evidence comprises `domstack-html-profile-{1,2,3}.jsonl`, matching driver/audit reports, `domstack-html-profile-summary.json`, `domstack-html-experiment-{before,cached}-{1,2,3}-{driver.json,counts.jsonl}`, and `domstack-html-isolated-{1,2,3}.json` under Oro's `test-results/`.
With fresh evidence paths, reproduce profiles using `python3 test-results/run-domstack-html.py --run 1` through run 3 and experiments using `python3 test-results/run-domstack-html-experiment.py --round 1` through round 3.
Runners refuse to overwrite their existing reports and use bounded child processes with package restoration in `finally`.

Oro's original beta.8 package was restored after every run and confirmed to be a real directory, with no experimental backup or package link remaining.
Oro's tracked files are unchanged, and its local tools, source data, and private evidence are not committed.
The accompanying DOMStack checkpoint records only this investigation and the plan update; no push is made.
