# Issue 334: fingerprint optimization results

Phase 4 of the [watch-performance plan](334-watch-preparation-performance.md) is implemented on `perf/334-markdown-preparation`, checkpointed in `20a419c` after the measurements below.
Source-write stabilization is explicitly deferred; this change does not alter watcher timing or event handling.

## Implementation

`lib/build-pages/global-data/watch-dependencies.js` now uses two fast paths:

- Supported top-level primitives use their native JSON representation directly, avoiding the intermediate JSON parse and second stringify.
- Ordinary arrays and plain/null-prototype objects combine validation and canonical serialization in one recursive traversal, avoiding the full JSON stringify/parse round-trip and intermediate parsed graph.

Both paths retain the existing SHA-256 digest and exact canonical bytes.
Object keys still use the shared helper's `localeCompare` ordering, including stable ties, rather than introducing a different lexical sort.
JSON handles scalar/key escaping and numeric representation.
The shared `lib/helpers/stable-json-stringify.js` implementation and its other consumers are unchanged.

Validation continues to reject lossy shapes, including nonfinite numbers, negative zero, unsupported primitives, accessors, hidden/symbol properties, sparse or extended arrays, and cycles where the legacy implementation rejected them.
Aliases are allowed and compared by value; the ancestor set detects cycles rather than globally rejecting repeated references.
Opaque values still receive a null fingerprint and invalidate on every build.
All returned global-data keys are still fingerprinted, regardless of producer state, identity, subscription membership, or input deltas.
There is no new application API, hash requirement, cache format, or migration.

### Conservative fallback

The unchanged legacy validator and serializer handle cases for which ordinary-property traversal cannot reproduce JSON behavior safely:

- Proxies, including nested/revoked proxies, before invoking their traps.
- Inherited object/array `toJSON` hooks and unusual array prototypes.
- Boxed primitives, including wrappers whose prototypes were changed.
- Native raw-JSON values when that API is available.
- Deep graphs reaching the fast path's 128-ancestor guard.

Fallback propagates to the root without invoking user hooks on the speculative traversal, then runs the legacy path.
The depth guard requests fallback rather than introducing a new maximum supported input depth.
Independent review identified raw-JSON values and altered-prototype wrappers as important internal-slot cases; both were fixed and covered before final measurements.

## Compatibility and deterministic work checks

`lib/build-pages/global-data/fingerprint.test.js` includes 27 tests covering:

- Explicit legacy JSON bytes and hashes for 42 primitive fixtures, including control characters, lone surrogates, Unicode, subnormals, and extreme finite numbers.
- Type separation, exact existing-snapshot compatibility, changed-key ordering, and repeated opaque invalidation.
- No `JSON.parse` on supported fast paths and no whole-graph stringify for ordinary structured values.
- Unchanged shared-helper behavior.
- An independent legacy validator/serializer reference and 80 seeded structured graphs.
- Aliases, cycles, special property names, integer-like keys, locale collation ties, null prototypes, unsupported descriptors, and array shapes.
- Inherited hooks, custom array prototypes, side-effecting/throwing/revoked proxies, fallback trap order, and deep graphs.
- Raw-JSON canonicalization and transitions to ordinary lookalikes, plus altered-prototype boxed primitives and their invalidation behavior.

Raw-JSON cases skip on runtimes without the API; all ran on the validation runtime.

## Independent primitive measurement

Before implementing the structured path, the standalone benchmark compared the primitive-only change with an untouched pre-phase-4 snapshot.
It used 20 measured pairs and three excluded warm-up pairs, alternating implementation order.

| Fixture | Previous median | Primitive-only median |
| --- | ---: | ---: |
| 1,000 small top-level primitive keys | 0.738 ms | 0.632 ms |
| One large escaped/Unicode string | 24.368 ms | 13.512 ms |
| 585 structured documents | 27.400 ms | 27.221 ms |

As expected, the primitive-only change did not materially improve the structured fixture.
Oro returns 15 structured top-level values, so its principal gain requires the structured fast path.

## Final paired microbenchmarks

`scripts/benchmark-fingerprints.js` runs the current tracker and a trusted pre-change module snapshot on identical data, verifying exact fingerprints and invalidation results after every update.
Input construction, module imports, and assertions are outside the timed section.
Timing includes hashing and changed-key comparison, not just serialization.
No forced GC or brittle timing assertions are used.

The final version ran in three fresh Node processes on macOS arm64, Apple M1 Max, Node v26.8.2.
Each process used three excluded warm-up pairs and 20 measured pairs per fixture, alternating implementation order.

| Fixture | Range of previous medians | Range of optimized medians |
| --- | ---: | ---: |
| 1,000 small primitive keys | 0.721–0.733 ms | 0.610–0.641 ms |
| One large escaped/Unicode string | 24.349–24.858 ms | 13.434–13.771 ms |
| 585 structured documents | 27.580–27.847 ms | 14.152–14.550 ms |
| Captured actual Oro producer data, 15 keys | 48.826–49.886 ms | 24.636–25.381 ms |

All fixtures had zero opaque keys and matched the baseline hashes exactly.
Captured Oro data is source-bearing private benchmark input, retained only in ignored test evidence.
These warmed microbenchmarks do not estimate the cost of fresh-worker module loading or total watch latency.

## Oro end-to-end comparison

The before/after packages both include the previously implemented Markdown optimizations and use Oro's same installed dependencies.
The runtime snapshots were verified to differ only in `lib/build-pages/global-data/watch-dependencies.js`.
This isolates phase 4 rather than comparing again against unoptimized beta.8.
No dependency installation, manifest edit, or lockfile rewrite was performed.

Three fresh processes per variant each ran one watch session, one excluded warm-up, and five measured edits of the same real Oro Markdown document.
Pair order was before/after, after/before, before/after.
The existing uninstrumented driver and output assertions were retained, including the in-place write operation.

| Measurement | Before fingerprints | Optimized fingerprints |
| --- | ---: | ---: |
| Measured edits | 15 | 15 |
| Median edit-to-settled | 368.90 ms | 339.28 ms |
| p95 edit-to-settled | 392.17 ms | 363.19 ms |
| Median initial watch startup | 5.738 s | 5.707 s |

Median edit latency decreased by approximately **29.62 ms, or 8.0%**, beyond the existing Markdown optimizations.
These are local sequential comparisons with alternating pair order, not randomized trials or cross-machine guarantees.
The small startup difference is not strong evidence of an initial-build improvement.

All 30 measured edits produced one build and passed:

- Updated HTML with the current marker and no stale markers.
- Exact raw Markdown bytes.
- Correct search entry and LLM-pack body/source URL.
- Exactly one rewritten article HTML and one rewritten raw sidecar, with other outputs in those groups untouched.

The first before-variant warm-up produced two builds; all other timing-run warm-ups produced one.
That sample remains recorded and excluded under the existing warm-up protocol.
No stabilization or debounce mitigation was enabled to obtain these results.

### Separate worker profiling

`oro-website/tools/profile-domstack-fingerprints.mjs` instruments worker fingerprint updates, independently of the timing runs.
One initial build, one warm-up, and two subsequent edits were profiled per variant.

| Fingerprint update | Before | Optimized |
| --- | ---: | ---: |
| Initial build | 82.14 ms | 44.14 ms |
| Median across three edits | 60.38 ms | 31.72 ms |

All 15 initial producer fingerprints matched exactly between implementations.
The edit profiles are separate measurements, not part of the end-to-end timing table.
The distinction from the warmed microbenchmarks is expected: actual builds execute inside fresh workers with current application data and different allocation/JIT history.

## Validation and repository state

- Full `node --test --test-reporter=spec`: **720 passed, 2 existing TODOs, no failures**.
- Full DOMStack lint and type checking passed.
- Targeted fingerprint tests and independent compatibility review passed after the JSON-special fallbacks were added.
- Oro type checking and profiler syntax checking passed.
- All 30 timed Oro edits and the separate profiling-run edits passed output checks.

The initial lint run found formatting-only issues in the new benchmark script; the repository's ESLint fixer resolved them before final validation.
The previous Oro browser/content audits were not rerun because this phase changes fingerprint computation rather than rendering, and hashes plus incremental outputs were validated directly.
Oro's original installed beta.8 package was restored after every run.
No application source, original public output, manifest, or lockfile was changed, and no commits were created during these measurements.

## Reproduction and evidence

From DOMStack, with the retained pre-change snapshot and private producer-data capture:

```sh
node scripts/benchmark-fingerprints.js --baseline test-results/fingerprint-before/lib/build-pages/global-data/watch-dependencies.js --data /Users/bret/Developer/oro-website/test-results/domstack-fingerprint-data.bin
```

Ignored DOMStack evidence includes `fingerprint-primitives.json`, `fingerprint-final-{1,2,3}.json`, and `fingerprint-full-tests-final.log`.
Earlier prototype measurements remain separately named `fingerprint-combined-{1,2,3}.json`; the final tables use the guarded final implementation, not those earlier samples.
Ignored Oro evidence includes `domstack-fingerprint-{before,after}-{1,2,3}-driver.json`, `domstack-fingerprint-profile-{before,after}-1.jsonl`, their driver reports, and the local `run-domstack-fingerprint.py` link/restore runner.
The capture and snapshots are intentionally not committed.

The next independent optimization workstream is dependency-analysis reuse from phase 5.
