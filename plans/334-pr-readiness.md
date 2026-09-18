# Issue 334: final branch review and PR readiness

Reviewed `perf/334-markdown-preparation` through implementation/documentation checkpoint `e8269dc` against base `bfbb0c8` (`v12.0.0-beta.8`, the local `origin/master` reference).
This review did not fetch remote refs, push, publish, create a PR, or rewrite checkpoints.
The accompanying checkpoint changes documentation only.

## Verdict

**No blocking correctness findings in the reviewed optimization changes.**
The branch is ready to present for PR review with the compatibility notes and validation exceptions below.
This is not an unconditional release sign-off: two existing browser-test failures reproduce on the base commit, and the Linux/LTS CI matrix has not been run locally.
No additional optimization implementation is recommended before review.

Three independent read-only reviews covered:

- Markdown source preparation, clone fidelity, renderer sharing/laziness, retry behavior, and worker-cache transport and acceptance.
- Fingerprint fast-path equivalence, descriptors, proxies, JSON hooks, collections, cycles versus aliases, fallback behavior, and changed-key invalidation.
- Dependency-analysis retention, skipped and in-flight events, observation boundaries, failure/reset handling, and watch-session ownership.

All three returned no actionable blockers in their assigned slices.
Their conclusions were based on source/test inspection; the validation below was run separately, serializing test suites and without concurrent benchmarks.
The review is not an exhaustive proof of equivalence for arbitrary runtime monkey-patching or unobserved filesystem changes.

## Validation on Node v26.8.2, macOS arm64

| Check | Result |
| --- | --- |
| `npm run test:installed-check` | Passed |
| `npm run test:neostandard` | Passed |
| `npm run test:tsc` | Passed |
| `npm run test:node-test` | Passed with the normal coverage reporters |
| `node --test --test-reporter=spec` | 780 passed, zero failed, two existing TODOs |
| `npm run test:playwright` | 14 passed, two timed out |
| Same two Playwright tests on base `bfbb0c8` | Both reproduced the same failures |
| `git diff --check bfbb0c8...HEAD` | Passed at the reviewed checkpoint |
| `npm pack --dry-run --ignore-scripts --json` | New runtime modules included; tests, plans, and private evidence excluded |

Individual test scripts were run rather than `npm test` so the wrapper's cleanup would not remove existing local outputs or declarations unnecessarily.
No declaration build was needed or performed.
The package dry run deliberately skipped lifecycle scripts and therefore does not validate the release-time declaration generation or a packed-package installation.
No dependency, lockfile, engine, package-entry, browser-test, or documentation-site runtime changes are present in the net branch diff.
No prewarming references remain in `lib/**/*.js`, and the worker entrypoint itself matches the base commit.

Ignored local evidence includes `test-results/334-final-review-node-tests.log`, `334-final-review-node-spec.log`, and `334-final-review-package.json`.

### Existing browser failures, not introduced by this branch

Both failures are in unchanged `browser-tests/docs-navigation.spec.js`:

- Test at line 53, “global bundles and cookbook subpages are linked from the documentation”: the `All recipes` click at line 73 times out waiting for the element to be visible, enabled, and stable.
- Test at line 118, “migration links support pointer navigation”: the `All migrations` click at line 123 times out at the same actionability stage.

The tests hit their configured 10-second test timeout; the subsequent “Target page, context or browser has been closed” message is emitted when the outstanding click is cancelled.
The underlying actionability cause was not diagnosed in this optimization review.
No timeout increases, forced clicks, skipped assertions, or unrelated navigation fixes were introduced to make the suite green.

For baseline attribution, a disposable `git archive bfbb0c8` snapshot used the same installed dependencies and browser executable, then ran:

```sh
npm run test:playwright -- \
  --grep 'global bundles and cookbook|migration links support pointer' \
  --output=../334-review-baseline-playwright
```

Both failures reproduced at the same click operations on that unmodified base.
The disposable source snapshot was removed afterward so later Node test discovery cannot traverse a second repository's tests.
Candidate failure artifacts remain under `test-results/playwright/`, and baseline artifacts under `test-results/334-review-baseline-playwright/`.
The browser suite is not fully green; carry this exception into the PR and handle it separately from the performance changes.

## Compatibility and release notes to surface

- Synchronous metadata access, eager title inference where needed, source snapshots, independent raw Markdown reads, and fresh application-module execution remain intact.
- Only the default Markdown renderer without custom settings/resolvers defers initialization until rendering.
- Default renderer initialization errors therefore occur at first render instead of metadata-only preparation.
- Each page's first default render crosses an asynchronous initialization boundary, even when another page has already initialized the shared renderer; callers should not mutate render inputs until the promise settles.
- Custom Markdown settings and caller-supplied resolvers stay eager to preserve their side effects, warnings, and error timing.
- Handlebars loads only on enabled renders and still compiles each enabled render using current inputs and shared helpers.
- Applications relying on Handlebars' incidental `.hbs`/`.handlebars` require hooks must explicitly import Handlebars rather than relying on DOMStack to install them eagerly.
- Source and dependency caches trust observed watch events and reset metadata, with conservative recovery; they do not revalidate every file on every hit.
- Existing static re-export analyzer limitations and the two TODOs associated with issue #328 remain unresolved and are not claimed as fixed.

No application-facing invalidation API or new dependency is required.
The generated changelog and package version were not edited as part of review.

## Suggested PR framing

Suggested title: **Reduce repeated source preparation, fingerprinting, and dependency analysis in watch builds**.

Address issue #334 by retaining cloneable Markdown source preparation between eligible watch builds, reducing title-parser and fingerprint work, reusing observed dependency analysis, and avoiding unused default renderer/Handlebars initialization.
Keep fresh per-build workers and current application execution rather than retaining live pages or executable modules.

Link the [main plan](334-watch-preparation-performance.md) and its per-phase reports rather than adding individual benchmark improvements together.
The original issue's instrumented baseline and later uninstrumented comparisons are not interchangeable.
The [fingerprint](334-fingerprint-results.md) and [dependency-analysis](334-dependency-analysis-results.md) reports contain isolated Oro comparisons; the [lazy-preparation report](334-lazy-preparation-results.md) explicitly shows no convincing Oro improvement from that later extension.
The lazy default-renderer benefit is instead demonstrated by the metadata/template-only benchmark.

Retain the experiment decisions visibly:

- HTML source caching: measured and deferred, not implemented.
- Layout-chain caching: measured and deferred, not implemented.
- Write stabilization: investigated and deferred; current Chokidar settings retained.
- Worker prewarming: rejected and removed; its implementation and removal commits remain historical checkpoints only.
- Lazy H1/variable evaluation: optional and unexplored, not a release requirement.

Report the successful Node/lint/type/package-content checks and the two base-reproduced browser failures without claiming a fully passing CI run.
Before merging or releasing, refresh the target-branch comparison and run the repository's Linux LTS/latest CI matrix; decide separately how to track and resolve the existing browser failures.

## Repository state

Oro's original installed beta.8 package remains a real directory, not a local link, and no HTML/lazy experimental package backup remains.
Oro's tracked files are unchanged; untracked local validation tools and ignored private evidence remain outside this branch.
No Oro commit, push, release, or PR creation was performed.
