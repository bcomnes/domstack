# Issue 334: Oro local-link validation

Validated the uncommitted `perf/334-markdown-preparation` implementation against the local Oro website checkout.
Oro was on `refactor/domstack-improvements`, revision `56c77f7`, with published DOMStack 12.0.0-beta.8 installed.
No commits were created in either repository.
The subsequent [cache resource report](334-cache-resource-results.md) adds actual-payload transport and controlled memory measurements, plus duplicate builds observed in later uninstrumented runs.

## Environment and isolation

- macOS arm64, Apple M1 Max, Node v26.8.2, npm 11.19.1.
- Actual Oro source: 605 source pages, including 585 Markdown documents.
- Target: `src/runtime/docs/guides/hello-world/page.md`.
- A temporary local symlink selected the DOMStack working checkout without editing Oro's package manifest or lockfile.
- The original installed package was retained and restored after validation.
- Watch sessions used fresh isolated copies of all Oro sources, with the package imports map, CNAME, and access to the installed dependencies.
- Authored `src/` and the existing `public/` directory were not modified.
- Clean-build outputs and validation evidence remain under ignored `oro-website/test-results/`.

All timing variants used the same source-page SHA-256:

```text
c846a88c921311bbaacea5e60c4406e66e34f5fd0e4a53a149d601da396af7ae
```

## Timing protocol

The reusable driver is `oro-website/tools/benchmark-domstack-watch.ts`.
It starts timing immediately before an in-place body-only source write, waits for the unique marker in HTML, then awaits public `site.settled()`.
HTML polling is every 10 ms.
The site runs through `DomStack.watch({ serve: false })`, with real workers and filesystem notifications.

Each main variant ran three fresh watch sessions, with one retained-but-excluded warm-up and five measured edits per session.
This gives 15 measured edits per main variant.
A beta.8 recheck afterward used one session, one warm-up, and five measured edits.
All runs were serial and uninstrumented; profiling was performed separately.

Source copying, initial startup, artifact verification, output snapshots, quiet draining, and cleanup are outside edit timing.
A 500 ms quiet/drain window separates operations and attributes any delayed builds to the preceding edit.
The driver retains raw event logs and separates single-build from multi-build samples.
No measured edit or warm-up produced a double build in these runs, so the issue's original first-edit double-build observation remains unresolved.

## Results

| Variant | Measured edits | Median edit-to-settled | p95 edit-to-settled | Median watch startup |
| --- | ---: | ---: | ---: | ---: |
| Installed beta.8 | 15 | 548.60 ms | 606.99 ms | 5.980 s |
| Direct link to working checkout | 15 | 390.81 ms | 415.83 ms | 5.811 s |
| Candidate snapshot, Oro-matched dependencies | 15 | 358.79 ms | 373.53 ms | 5.828 s |
| Installed beta.8 recheck | 5 | 547.66 ms | 562.14 ms | Not used for the startup comparison |

The direct link reduced median latency by approximately 158 ms, or 28.8%.
The dependency-matched candidate reduced median latency by approximately 190 ms, or 34.6%.
The beta.8 recheck supports the baseline remaining stable across the sequential experiment.
These are local wall-clock observations, not randomized trials, confidence intervals, or cross-machine guarantees.
The smaller startup differences are not strong evidence of an initial-build speedup.

### Why a dependency-matched run was added

A direct source link resolves dependencies from the DOMStack checkout, which differs from Oro's installed dependency tree.
The following direct dependencies differed:

| Dependency | Oro's installed beta.8 resolves | Working checkout resolves |
| --- | --- | --- |
| esbuild | 0.28.2 | 0.28.1 |
| highlight.js | 11.12.0 | 11.11.1 |
| ignore | 7.0.9 | 7.0.5 |
| js-yaml | 5.4.2 | 5.2.1 |
| markdown-it | 15.0.2 | 15.0.1 |
| markdown-it-attrs | 5.0.1 | 5.0.0 |
| mine.css | 11.0.12 | 11.0.6 |
| p-map | 7.0.8 | 7.0.5 |

For the additional comparison, the candidate runtime was copied to an isolated package under `test-results/` and linked to Oro's existing `node_modules`.
All 38 direct dependency versions were verified to match the installed baseline before running it.
No dependency installation, upgrade, or lockfile rewrite was performed.
The difference between the two candidate timings should not itself be attributed exclusively to dependency versions, because package location and run order also differ.

## Output correctness

Every benchmark edit verified:

- Updated article HTML contains the current marker and no prior marker.
- Raw Markdown at `runtime/docs/source/guides/hello-world.md` matches the exact edited body bytes.
- Exactly one search entry has the marker, with the expected document identity and URL.
- `runtime/llms.txt` contains the exact edited body and its raw source URL.
- No stale marker remains in HTML, raw Markdown, search JSON, or the LLM pack.
- Across every generated HTML file, exactly `runtime/docs/guides/hello-world/index.html` changed its stat signature.
- Across all documentation raw sidecars, exactly the edited document's raw file changed its stat signature.

Output stat signatures include nanosecond mtime/ctime, inode, and size, excluding atime.
All 50 measured edits across the four timing variants passed these checks and had one successful build each.

Separate clean builds with the installed package and the direct working-checkout link each produced 1,238 files.
SHA-256 comparisons matched for 1,237 files byte-for-byte, including HTML, raw documents, search, LLM packs, and browser bundles.
The only difference was `domstack-esbuild-meta.json`, whose output paths include the deliberately different destination directories.
After normalizing those destination prefixes, its parsed records were identical too.

## Separate preparation profiling

The preload is `oro-website/tools/profile-domstack-preparation.mjs`.
It uses worker-local Node module-load hooks, verifies exact source anchors, and fails loudly if expected instrumentation is absent.
No on-disk runtime or application module is patched.
It appends one JSONL record before each completed page worker sends its result.

Each variant was profiled with one initial build, one warm-up edit, and two subsequent edits.
The following counts were stable across all three single-document edits in each profiling run:

| Work per single-document rebuild | Installed beta.8 | Direct-linked candidate |
| --- | ---: | ---: |
| Markdown preparation reads | 585 | 1 |
| Title extractions | 585 | 1 |
| Markdown renderer initialization calls | 9 | 1 |
| `renderInnerPage()` calls | 2 | 2 |
| Reported output pages | 1 | 1 |

Preparation-read counters exclude explicit `readMarkdownContent()` calls used by the application and raw-output hook.
Title and renderer counters count function-entry attempts.
Initial builds still read and title-process all 585 Markdown sources; the cache removes this repeated work from eligible incremental builds, not from startup.
The two render calls on edits are expected: application search-text rendering and final page rendering.
Profiling-run timings were not used in the timing table.

### Cache transport and memory observations

Each candidate edit worker received 585 prepared Markdown entries.
Their `node:v8.serialize` size was approximately 6.91 MB, or 6.59 MiB.
The returned candidate delta contained one upsert and one removal and serialized to 8,317 bytes, or approximately 8.12 KiB.
The initial full candidate serialized to approximately 6.91 MB.

These are serialized proxy payload sizes, not measured structured-clone IPC bytes or transfer time.
The parent-to-worker path still sends the full accepted source baseline; only the return path is delta-based.

Worker-isolate heap snapshots immediately after edit builds were approximately 139–139.5 MiB for beta.8 and 166–168.3 MiB for the direct-linked candidate.
Snapshots were instrumented, not GC-normalized, and are neither retained-memory measurements nor peaks.
Process-wide RSS includes other workers and allocations and cannot be attributed to this cache from these samples.
The data shows a latency improvement with additional cache/payload costs, but does not establish a stable peak-memory budget or a leak.
Actual-payload clone/dispatch timing, controlled retained-memory measurements, and process-wide peaks are covered in the subsequent resource report.
The snapshots in this initial report are not a substitute for those measurements.

## Additional validation

All of the following passed with the working checkout linked:

- Oro application tests: 57 passed.
- Oro type checking, after temporarily generating DOMStack declarations.
- Output audit: 607 HTML pages and 147,853 internal links and anchors passed.
- Content audits passed.
- Tooling tests: 15 passed, including the actual standalone-watch body/title/raw-path/delete checks.
- Site-output tests: 6 passed against the isolated candidate artifact.
- Browser tests: 18 passed against the isolated candidate artifact, covering desktop and mobile.

The first linked typecheck lacked generated DOMStack declarations; generating them resolved the failure without changing application types.
The first isolated site-test attempt lacked a link to canonical branding assets; adding that fixture link resolved its filesystem error.
The initially requested Playwright browser revision was absent, so browser tests used the existing `ORO_BROWSER_EXECUTABLE` override with cached Chromium headless shell revision 1228.
The default configuration expected revision 1243; no browser download was performed.
The clean-build invocation uses the CLI rather than an eval command with `--input-type`, which workers would otherwise inherit incompatibly.

DOMStack declarations were removed with the repository's declaration-cleanup scripts after validation.
Oro's original beta.8 package directory was restored; the working checkout is not left linked.
`src/`, `package.json`, and `package-lock.json` have no changes.
At the end of this initial validation, only the two new validation tools remained uncommitted in Oro, alongside ignored test evidence.
The resource follow-up adds two more tools without modifying application sources.

## Reproduction and evidence

From Oro, using whichever package is currently installed or locally linked:

```sh
node tools/benchmark-domstack-watch.ts --sessions 3 --edits 5 --warmup 1 --label LABEL > test-results/domstack-watch-LABEL.json
```

The profiling preload requires `DOMSTACK_PROFILE_FILE` and, for the linked candidate, `DOMSTACK_PROFILE_ROOT` pointing to the actual candidate package root.
Run it separately from timing comparisons.

Evidence retained under `oro-website/test-results/`:

- `domstack-watch-before.json`
- `domstack-watch-after.json`
- `domstack-watch-matched.json`
- `domstack-watch-before-recheck.json`
- `domstack-profile-before.jsonl` and `domstack-profile-after.jsonl`
- `domstack-profile-before-driver.json` and `domstack-profile-after-driver.json`
- `domstack-clean-before/` and `domstack-clean-after/`
- `domstack-validation-checks/`, including the isolated browser-test setup

The next independent optimization candidates remain global-data fingerprinting and dependency-analysis reuse.
The resource follow-up subsequently observed duplicate builds in uninstrumented runs.
The [duplicate-build investigation](334-duplicate-build-investigation.md) then traced and reproduced a scheduling-sensitive mechanism on both beta.8 and the candidate, without changing production event handling.
