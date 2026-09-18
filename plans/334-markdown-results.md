# Issue 334: first Markdown optimization results

Branch: `perf/334-markdown-preparation`.
Baseline revision: `bfbb0c843053e0ab32d52d39fe8abfa738a3701b`.
Scope: phase 1 of the [watch-preparation plan](334-watch-preparation-performance.md), plus reusable local benchmarking.

## Implemented

- Disable inline parsing in the dedicated H1 extractor while retaining Markdown block parsing and raw heading content.
- Skip H1 inference when frontmatter explicitly overrides the title, including empty, null, false, and zero values.
- Share pending and resolved Markdown renderers through a resolver created for each `buildPagesDirect()` invocation.
- Keep separate resolver entries for distinct settings paths and evict rejected initialization promises.
- Capture each page's resolved renderer in its render closure instead of accessing mutable module-global state.
- Preserve settings-error fallback, source snapshots, and fresh-worker behavior.

The resolver is passed only through worker-local builder options, not through the worker transport protocol.
Standalone builder calls without a build-scoped resolver initialize their own renderer rather than retaining process-global settings.
Sharing an existing settings path within a build does not normalize alternative path or URL spellings.

Source-preparation caching, lazy initialization, fingerprint changes, dependency-index reuse, layout-chain reuse, and worker prewarming are not part of this change.

## Benchmark method

The reusable script is `scripts/benchmark-watch-markdown.js`.
It copies the checked-in `test-cases/page-outputs/src` fixture into a temporary directory and replicates its article into 100 Markdown pages.
Each document includes eight deterministic sections with tables, inline formatting, code highlighting, task lists, alerts, a table of contents, and footnotes.
Only `article/page.md` is edited, with a unique body marker each time.

Timing starts immediately before writing the source and ends after the updated HTML is observed and public `site.settled()` resolves.
The benchmark runs without a server and checks updated HTML, exact raw Markdown, JSON metadata, and unchanged content, timestamps, and inode for one sibling's three outputs.
Setup, correctness assertions, quiet draining, and cleanup are outside edit timing.
A 500 ms quiet/drain window separates edits; any additional builds observed there are attributed to the preceding edit and reported separately from its timed interval.
This reduces delayed-event attribution problems but is not proof that the filesystem will never deliver a later event.

The comparison used an isolated archive of the baseline revision with the same benchmark script and shared installed dependencies, followed by the working branch.
The baseline copy was removed after measurement.
All benchmark runs were serial, without concurrent test runs.
Environment: macOS arm64, Apple M1 Max, Node v26.8.2.

### Timing runs

For each title mode and revision, run three fresh watch sessions with one excluded warm-up and ten measured edits per session.
This gives 30 measured edits per cell and 120 measured edits total.
Sessions are sequential in one Node process per command, not independently cold processes.

```sh
node scripts/benchmark-watch-markdown.js --pages 100 --edits 10 --sessions 3 --warmup 1 --settings plain --title explicit
node scripts/benchmark-watch-markdown.js --pages 100 --edits 10 --sessions 3 --warmup 1 --settings plain --title inferred
```

`--settings plain` installs a pass-through settings module without counter writes, preserving settings-module loading without timing instrumentation overhead.
The explicit-title workload retains the fixture's frontmatter title.
The inferred-title workload removes only that field, so metadata must obtain the same title from the Markdown H1.

| Workload | Before median | After median | Before p95 | After p95 | Median reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| Explicit titles | 263.13 ms | 213.76 ms | 272.84 ms | 222.26 ms | About 19% |
| Inferred titles | 261.43 ms | 233.26 ms | 268.99 ms | 242.28 ms | About 11% |

All measured edits were single-build samples and passed the output and sibling checks.
The script retains individual samples and reports single-build and multi-build groups separately when they occur.
Percentiles use nearest rank.

| Initial watch startup | Before median | After median |
| --- | ---: | ---: |
| Explicit titles | 612.61 ms | 562.29 ms |
| Inferred titles | 617.61 ms | 579.41 ms |

Startup measures the `watch()` call and excludes fixture setup and the subsequent quiet/drain period.

### Renderer initialization counts

Separate instrumented runs used one session, one excluded warm-up, and three measured edits per revision.

```sh
node scripts/benchmark-watch-markdown.js --pages 100 --edits 3 --sessions 1 --warmup 1 --settings on --title inferred
```

| Counter | Before | After |
| --- | ---: | ---: |
| Settings callbacks per measured rebuild | 8 | 1 |
| Successful builds per measured edit | 1 | 1 |

The counter writes outside the watched source and output directories and therefore adds I/O overhead.
Its timings are not used in the performance table.
It counts configured renderer initialization, not title-parser invocations.
Unit tests independently assert that overridden titles perform zero title parses and missing titles still invoke extraction.

## Validation

- 166 focused and integration tests passed across Markdown builders, page initialization, worker behavior, watch source snapshots, settings reloads, and page outputs.
- Full Node test suite passed on rerun with `node --test --test-reporter=spec`: 653 passed, 2 TODOs, no failures.
- The preceding `node --test --test-reporter=tap` run reported one failure while lint/type checks were running in parallel; that failure did not recur, and its cause was not established.
- Full-project `npm run test:neostandard` passed, including the runtime changes, Markdown tests, and benchmark script.
- `npm run test:tsc` passed without generating declarations.
- `git diff --check` passed.
- Browser/Playwright tests were not run; this change targets build-time Markdown preparation.
- The extractor regression suite compares explicit expectations and original-parser results across 62 cases and 126 block-context/newline combinations.
- Renderer regressions cover concurrent sharing, settings separation, direct-build lifetime, genuine rejection/retry, synchronous settings fallback, asynchronous settings fallback/recovery, and captured renderer identity.

## Interpretation and remaining work

These results apply to the combined phase 1 changes on this local fixture, not to individual optimization contributions.
This is not the Oro site and does not reproduce its stateful search/LLM producer, dependency graph, or 605-page input set.
The baseline/candidate order was sequential rather than randomized, and there are no confidence intervals or cross-machine comparisons.
Do not extrapolate these percentages to Oro or claim that unchanged-source reads have been eliminated.
The source initialization loop and source reads remain eager.

The first-edit double-build observation from the issue was not reproduced in these measured runs and is not considered fixed.
Run the original Oro correctness and edit-to-settled workload before making claims about that application.
The subsequent Markdown preparation split and watch-owned cache are recorded separately in the [source-cache results](334-markdown-cache-results.md).
