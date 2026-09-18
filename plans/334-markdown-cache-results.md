# Issue 334: Markdown source-preparation cache results

Branch: `perf/334-markdown-preparation`.
Scope: the Markdown preparation split and watch-owned cache from phases 2–3 of the [implementation plan](334-watch-preparation-performance.md).
This builds on the [phase 1 Markdown optimizations](334-markdown-results.md).

## Implemented

`lib/build-pages/source-preparation/markdown.js` now prepares source independently of its renderer.
It reads Markdown, splits and parses frontmatter, and computes builder variables including the existing title inference/override semantics.
The Markdown builder creates its current renderer separately and captures the prepared body in the render closure.

`lib/build-pages/source-preparation/markdown-cache.js` retains only source-derived records for current source-backed Markdown pages.
Each accepted entry has a normalized absolute filepath key, a normalized source-relative identity, the Markdown body, and source-derived variables.
HTML, executable page functions, companion/global/layout vars, generated definitions, subscriptions, output records, and renderer objects are not cached.
Titles remain eager on cache misses; there is no lazy metadata API or promise-valued `page.vars`.

The cache is private to each watch session and is independent of optional application global-data state.
Fresh worker builds continue to initialize all page runtime objects and resolve current layouts, executable vars, assets, hooks, and data subscriptions.
An unchanged eligible Markdown page now avoids source reading, frontmatter parsing, and H1 parsing during preparation.
Explicit calls to `readMarkdownContent()` remain independent filesystem reads.

## Invalidation and acceptance

- Use the existing input changes, direct source-event paths, and reset reasons, not output-selection filters.
- Refresh changed/new sources and reconcile membership against current discovery.
- Validate source-relative identity as well as absolute path, preventing reuse after identity/type replacement.
- Discard reuse when the baseline or input-change metadata is absent, or a reset is requested.
- Exclude non-watch builds from caching even if internal baseline options are supplied.
- Omit baseline transport on resets, missing-change-metadata requests, and non-watch builds.
- Send accepted entries to fresh workers and return only candidate upserts/removals, with an explicit replacement flag.
- Emit candidates only after the page phase succeeds, and accept them only after output reconciliation and dependency refresh.
- Do not accept preparation when dependency analysis reports incomplete routing.
- Remove private preparation reports before public watch callbacks and clear session state on disposal.

No additional application hashes, change declarations, or invalidation API are required.
The existing failed-build recovery path forces fresh preparation rather than committing a failed candidate.
Existing handling of edits queued during active builds is retained.

## Metadata fidelity and isolation

Preparation is snapshotted before application code receives mutable metadata.
Cache hits also receive isolated metadata rather than the retained objects.
The supported data graph includes ordinary objects/arrays, primitive cloneable values, aliases/cycles, ordinary Dates, and ordinary Uint8Arrays used by YAML dates/binary values.
The fidelity guard inspects descriptors without invoking getters and rejects proxies before reflective access.
Custom prototypes, unsupported property descriptors, executable/exotic values, and shared-memory values conservatively fall back to uncached preparation.
A cache eligibility or cloning failure does not turn an otherwise valid source into a build failure.

## Work-avoidance and correctness tests

Direct-build counters verify six initial Markdown reads/title parses, one read/parse for a one-page delta, and zero for an unchanged delta.
The global-data callback still receives every page with fully resolved synchronous metadata.
Additional raw-content calls read the filesystem without triggering title parsing.

A watch test instruments reads inside real page workers and records transmitted preparation baselines.
Without any `global.data` producer, it verifies the following sequence:

| Build | Markdown preparation reads |
| --- | ---: |
| Initial two-page build | 2 |
| Edit B | 1 |
| Edit B again | 1 |
| Template-only rebuild | 0 |
| Another B edit | 1 |

Worker inputs also verify that each successful edit's new B metadata reaches later workers and that an empty delta preserves the accepted baseline.
These assertions would fail if watcher acceptance or transport were disabled, unlike output-only tests.

Coverage also includes:

- Cached Markdown rerendered with new source-derived global data and fresh companions/renderers.
- Nested application metadata mutations not accumulating across builds.
- Body, inferred-title, and explicit frontmatter edits.
- Global-vars/settings resets rereading silently changed source rather than transporting stale preparation.
- Imported helper and layout freshness.
- Rename, deletion, Markdown/HTML replacement, empty membership, and reintroduction.
- Idle stop/restart and independent-session behavior.
- A cached renderer retaining old source during an active build, independent raw reads observing a concurrent edit, and the queued build observing new source.
- Initialization, rendering, and cleanup failure recovery.
- Noncloneable baselines being omitted before worker construction when reuse is disallowed.
- Source-only delta reports, excluding noncloneable executable vars and avoiding return transport of unchanged bodies.

## Local before/after benchmark

The baseline for this comparison is the working phase 1 implementation immediately before source-cache changes, not the original beta.8 revision.
Both measurements ran serially using the same script and installed dependencies on macOS arm64, Apple M1 Max, Node v26.8.2.

```sh
node scripts/benchmark-watch-markdown.js --pages 100 --edits 10 --sessions 3 --warmup 1 --settings plain --title inferred
```

Each run uses 100 Markdown pages, three fresh watch sessions, one excluded warm-up per session, and ten measured edits per session.
The settings module is present but counter-free.
The benchmark checks HTML, exact raw Markdown, metadata, and untouched sibling outputs.
See the phase 1 report and script help for timing boundaries, quiet draining, and fixture details.

| Measurement | Phase 1 baseline | With source cache |
| --- | ---: | ---: |
| Median edit-to-settled | 229.99 ms | 210.42 ms |
| Mean edit-to-settled | 230.20 ms | 211.55 ms |
| p95 edit-to-settled | 233.90 ms | 224.53 ms |
| Median initial watch startup | 616.67 ms | 611.87 ms |
| Measured edits | 30 | 30 |
| Successful builds per measured edit | 1 | 1 |

The median improvement is approximately 8.5% beyond the phase 1 changes.
All output and sibling assertions passed, and no measured sample involved multiple builds.
These are sequential local measurements without randomized ordering or confidence intervals.
The startup difference is small and is not presented as evidence of a cold-build speedup.

## Validation

- `node --test --test-reporter=spec`: 690 passed, 2 existing TODOs, no failures.
- `npm run test:tsc`: passed without declaration generation.
- `npm run test:neostandard`: passed.
- `git diff --check`: passed.
- Subsequent [Oro local-link validation](334-oro-validation.md) passed application, tooling, site-output, and browser tests, type checking, and content/link audits.

## Oro workload validation

The subsequent [Oro local-link report](334-oro-validation.md) validates the actual 605-page workload, including its search/LLM producer, raw Markdown sidecars, and unchanged sibling outputs.
Median edit-to-settled latency fell from 548.60 ms with published beta.8 to 390.81 ms with the direct checkout link and 358.79 ms with an isolated candidate using Oro-matched dependencies.
These comparisons include both phase 1 and the source cache, unlike the phase-1-relative fixture comparison above.
Separate profiling showed Markdown preparation reads and title extraction entries falling from 585 to one per single-document edit, and renderer initialization entries falling from nine to one.
Clean-build artifacts matched byte-for-byte except for destination prefixes in esbuild metadata, which matched after narrow normalization.

## Remaining limits and follow-ups

The source cache still transfers accepted preparation into each fresh worker; only the return path is delta-based.
Oro's incoming baseline serialized to approximately 6.59 MiB, while its single-edit return delta serialized to approximately 8.12 KiB.
These are proxy sizes, not actual IPC byte counts or cloning-time measurements.
The subsequent [resource report](334-cache-resource-results.md) measures actual-payload clone/dispatch overhead, approximately 6.70 MiB of retained heap for a cache clone, controlled site heaps, and process-wide peak RSS.
Its explicit attribution limits and duplicate-build samples prevent treating the peak RSS differences as a stable cache-specific memory budget.
The benchmarks are sequential local measurements, not randomized trials or cross-machine performance guarantees.

Metadata/runtime initialization is still eager, and fresh module/layout loading, fingerprinting, and dependency-index rebuilding remain unchanged.
HTML source caching, lazy renderer/title initialization, and worker prewarming are not implemented.
No compact title-only cache was added because the full Markdown preparation cache is now available.
Later uninstrumented resource runs observed duplicate builds on some candidate edits, including non-first edits.
The [duplicate-build investigation](334-duplicate-build-investigation.md) subsequently reproduced delayed truncate/write notifications on both implementations and added edit-preservation coverage.
A stabilization policy and natural incidence comparison remain separate decisions; production event handling is unchanged.
