# Issue 334: selective lazy preparation

The selective-laziness follow-up to the [watch-performance plan](334-watch-preparation-performance.md) defers unused default Markdown rendering dependencies and optional Handlebars loading.
This is a targeted work-avoidance optimization, not a demonstrated Oro watch-latency improvement.
No speculative workers, retained application workers, live-page cache, or rendered-output cache are introduced.

## Implemented scope

- Default Markdown renderer initialization waits until a prepared page is first rendered, provided no custom Markdown settings or caller-supplied resolver are present.
- The built-in resolver dynamically loads `get-md.js`, sharing one pending/resolved renderer per settings identity and build lifetime and evicting failed initialization promises for retry.
- Source reading, frontmatter, title inference, and page metadata remain eager or use the existing watch-owned source-preparation cache.
- Custom settings and caller-supplied resolvers remain eager, including custom loaders passed to `createMdResolver()`, so their initialization, side effects, warnings, and errors still precede source preparation.
- Markdown and HTML load Handlebars synchronously only inside the existing truthy `vars.vars.handlebars` branch.
- Every enabled render still compiles the captured source and observes current render inputs and the shared Handlebars package instance.
- Rendering retains the source snapshot even if the source file changes or disappears after preparation.

The first default render may await dependency loading and initialization.
This first-use boundary belongs to each page closure, even when another page has already initialized the build's shared renderer.
Once prepared, later renders do not add another dynamic-import await before invoking rendering.
Using synchronous conditional `require()` for Handlebars preserves interpolation and helper side effects before the render promise returns, unlike an unconditional asynchronous import at that point.

### Compatibility boundaries

Default renderer initialization errors now occur when rendering is first requested, rather than during metadata-only preparation.
Concurrent first renders share a failed initialization attempt; rejection eviction permits a later retry without rereading the captured source.
Custom settings and resolvers are deliberately excluded from this deferral.

Handlebars' incidental `.hbs` and `.handlebars` require-hook registration now occurs only when that package is loaded.
Applications relying on those hooks must explicitly import Handlebars instead of depending on DOMStack's former eager import.
The render flag is checked on every invocation, including disabled-to-enabled transitions.

Lazy H1 evaluation, variable-access redesign, and an HTML source-preparation cache are **not implemented**.
HTML source remains captured during preparation; HTML template compilation was already render-only.
Application imports, layout and companion validation, subscriptions, and synchronous metadata availability are not made lazy.

## Focused fresh-worker benchmark

`scripts/benchmark-lazy-preparation.js` builds a temporary site with 24 Markdown sources, no custom Markdown settings, and Handlebars disabled.
Global data consumes every inferred title synchronously and supplies a titles template.
The template-only scenario renders no pages; the second scenario renders one Markdown page in addition to the same template.

Three fresh benchmark processes each run ten measured before/after pairs and one excluded warm-up pair per scenario, alternating variant order.
Both snapshots use the same installed dependencies through Oro's `node_modules`.
The baseline contains phases 1–5 without prewarming, matching the runtime after removal checkpoint `2e73cad`.
The candidate differs only in the four runtime files listed below.

| Scenario | Baseline median range across three runs | Candidate median range across three runs |
| --- | ---: | ---: |
| Template only; all 24 titles consumed | 107.960–109.853 ms | 50.417–53.411 ms |
| One Markdown page rendered, plus template | 128.114–129.147 ms | 123.390–124.525 ms |

Template-only builds save approximately 56–58 ms, or 51–53%, by avoiding unused renderer/plugin loading and setup.
Once Markdown rendering is required, most of that cost returns; the observed benefit is only approximately 3.6–5.8 ms in this fixture.
Do not generalize the template-only result to custom-settings builds, which deliberately retain eager initialization.

The timer covers the parent `buildPages()` call through its result, including normal fresh-worker startup and output writes.
Imports in the benchmark parent, fixture setup, discovery, assertions, cleanup, and an untimed 100 ms teardown allowance are excluded.
That allowance is not an observed worker-exit barrier.
The script verifies build errors, report counts, all titles, the rendered heading, and the exact output file set.
Dependency matching is supplied externally, not enforced by the benchmark script.

Reproduce with dependency-matched package snapshots:

```sh
node scripts/benchmark-lazy-preparation.js \
  --baseline /Users/bret/Developer/oro-website/test-results/domstack-dependency-candidate \
  --candidate /Users/bret/Developer/oro-website/test-results/domstack-lazy-candidate \
  --iterations 10 --warmup 1 --pages 24
```

Ignored evidence is `test-results/lazy-preparation-benchmark-{1,2,3}.json` in DOMStack.
Measurements used Node v26.8.2 on macOS arm64 with an Apple M1 Max.

## Oro local-link validation

The separate uninstrumented comparison uses three variants: the phases 1–5 baseline, conditional Handlebars loading alone, and the full lazy candidate.
Each variant runs in three fresh processes, with one excluded warm-up and five measured edits per process.
Variant order rotates across rounds: baseline/Handlebars/lazy, Handlebars/lazy/baseline, then lazy/baseline/Handlebars.
All 45 measured edits and nine warm-ups passed output checks and produced exactly one build each.

| Measurement | Baseline | Handlebars only | Full lazy candidate |
| --- | ---: | ---: | ---: |
| Median edit-to-settled | 304.472 ms | 300.059 ms | 303.266 ms |
| Edit p95, nearest rank across 15 samples | 319.227 ms | 326.013 ms | 345.573 ms |
| Initial-build median across three processes | 5783.851 ms | 6123.306 ms | 5888.539 ms |
| Initial-build range | 5780.435–5794.797 ms | 6049.223–6168.352 ms | 5824.895–6196.353 ms |

The watch median is effectively flat; there is no convincing end-to-end Oro improvement from this change.
Observed tail latency and startup are higher for the candidates, so these small samples do not establish an absence of performance cost either.
With 15 samples per variant, nearest-rank p95 is the maximum sample.

Oro supplies custom Markdown settings returning its own renderer, so initialization intentionally remains eager.
The earlier promise-sharing optimization already reduced initialization to once per build in this workload.
The new default-renderer deferral is therefore not expected to benefit Oro's normal builds.

Output checks cover updated HTML, exact raw Markdown, search and LLM-pack content, expected rewrites, and untouched sibling outputs.
The local runner is `oro-website/test-results/run-domstack-lazy.py`; reports are `domstack-lazy-{before,handlebars,lazy}-{1,2,3}-driver.json` under Oro's ignored `test-results/`.
`domstack-lazy-runtime-audit.json` records the runtime snapshot comparison and hashes.

### Separate work profiling and interrupted cleanup

`oro-website/tools/profile-domstack-lazy.mjs` instruments module loading and Markdown work separately from latency measurement.
Completed baseline and Handlebars-only profiles each cover an initial build, a warm-up, and two edits.
They show 32 Handlebars module loads per baseline worker versus zero with conditional loading, and one Markdown initialization per build in both variants.
Initial builds invoke `renderMd` 1170 times and report 607 output pages; edit builds invoke it twice and report one output page.
Both completed profile-driver reports verify outputs, and all their workers report zero build errors.

The combined measurement command reached its 240-second limit during the final full-candidate profiling cleanup.
All nine uninstrumented timing reports and the baseline/Handlebars-only profile-driver reports had already completed successfully.
The full-candidate JSONL contains four successful worker records, but its final driver report is incomplete and is excluded from completed validation and comparison.
No longer-timeout rerun was needed for the narrow work-avoidance conclusion, which is independently covered by fresh-process regression tests and the completed Handlebars-only profile.

The timeout bypassed the runner's normal cleanup, so Oro's original installed package was manually restored after verifying the link and backup identities.
Final checks confirm that `node_modules/@domstack/static` is the original beta.8 directory, not a symlink, with no `static-lazy-original` backup left behind.
The four measured candidate runtime files match the final DOMStack implementation byte-for-byte.
Oro's tracked files remain unchanged; local tools and ignored evidence are not committed.

## Regression validation and checkpoint

- `npm run test:neostandard`: passed.
- `npm run test:tsc`: passed without generating declarations.
- `node --test --test-reporter=spec`: 780 passed, zero failed, and two existing TODOs.
- Final suite log: ignored `test-results/lazy-preparation-full-tests-final.log`.
- New Markdown tests cover skipped initialization, synchronous metadata, captured inputs, concurrent sharing, retry after failure, custom settings/resolver timing, and fresh-process module loading.
- New Handlebars tests cover flag transitions, compilation counts, shared helpers, malformed templates, source snapshots, live inputs, and synchronous interpolation timing.

Runtime changes are confined to `lib/build-pages/page-builders/md/create-md-resolver.js`, `md/index.js`, `md/get-md.js`, and `html/index.js`.
Tests live beside those builders in `md/lazy-renderer.test.js` and `lazy-handlebars.test.js`.
The accompanying checkpoint contains these changes, the focused benchmark, and this plan update on `perf/334-markdown-preparation`.
No Oro commit or push is part of this work.
