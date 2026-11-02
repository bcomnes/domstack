# Composition pages

## Status

- Branch: `composition-pages`.
- Overall status: implemented and validated.
- Last updated: 2026-11-02.

## Goal

Allow source-backed pages to supply content to other pages without automatically generating standalone page output.
The motivating example is `examples/cargo-like`, where the homepage collects slide bodies through `renderInnerPage()`.
Its intentional standalone preview pages remain unchanged.

## Final public contract

- Name the feature **composition pages** and use `compose` consistently for its API.
- Author concrete composition pages using `page.compose.md`, `page.compose.html`, or a supported `page.compose.js` / TypeScript module variant.
- Support `README.compose.md` and loose Markdown such as `chapter.compose.md`.
- Use `.compose.draft.ext` for a composition draft; `.draft.compose.ext` is not a canonical combined suffix.
- Discovery sets the required boolean `page.pageInfo.compose`: `true` for composition pages and `false` otherwise.
- Composition pages remain in page discovery, initialization, and global data collection.
- Explicit `renderInnerPage()` and `renderFullPage()` remain available, subject to existing data-subscription rules.
- Skip all automatic page-owned output: the primary file, page/layout `pageOutputs` hooks, and `workers.json`.
- Static assets and CSS/client/worker bundles retain their existing behavior.
- Composition status cannot be overridden by global, layout, companion, or builder vars.
- Neither `compose` nor `emit` is a special page var.
- No CLI toggle is introduced.
- Draft inclusion remains independent: enabling drafts includes composition drafts in the content pipeline without publishing them.
- Generated definitions accept top-level boolean `compose`, parallel to `draft`, defaulting to `false`.
- Generated pages remain downstream of global data and do not join its concrete-page collection.

```text
src/slides/study/page.compose.md
src/slides/opening/page.compose.js
src/slides/draft/page.compose.draft.md
```

```js
const compositionPages = pages.filter(page => page.pageInfo.compose)
const standalonePages = pages.filter(page => !page.pageInfo.compose)
```

URLs and output paths retain their normal hypothetical locations, not a guarantee of a published file.
For example, `chapter.compose.draft.md` has the output metadata `chapter.html` when drafts are included, but generates no automatic page file.

## Design decisions

Composition is determined during discovery, not during variable resolution.
This avoids competing discovery and initialized metadata snapshots, removes the need to replace `siteData.pages`, and keeps generated-page collision checks independent of initialization.
Composition pages do not reserve standalone output paths they will not produce.
Normal filenames retain priority over compose variants, and non-draft variants retain priority over drafts within each existing page convention.

The writer returns an empty ownership report for a composition page rather than omitting its report.
That preserves layout routing and allows watch cleanup to remove previously owned HTML, sidecars, and worker manifests after a filename change.
Static assets and bundle outputs are not page-owned outputs and remain available.

## Progress tracking

Use `[ ]` for pending work and `[x]` only for completed, verified work.
Update the status, decision log, and validation log when a phase changes.

### Phase 0: Planning

- [x] Agree on the feature name and create the `composition-pages` branch.
- [x] Replace the initial var-based design with discovery-time filename classification.
- [x] Standardize the API on `compose` and `pageInfo.compose`.
- [x] Agree on independent draft inclusion and canonical suffix ordering.

### Phase 1: Discovery and public metadata

- [x] Extend shared file conventions for supported page extensions, README, and compose drafts.
- [x] Discover composition pages without importing vars or rendering content.
- [x] Exclude reserved compose Markdown names from loose-page enumeration.
- [x] Strip composition/draft suffixes from loose Markdown output metadata.
- [x] Preserve existing filename priority and classify compose sources for watch scheduling.
- [x] Expose the required boolean in `PageInfo` and read-only output-hook metadata.
- [x] Update public type contracts and existing typed fixtures.

### Phase 2: Output and generated pages

- [x] Keep composition pages in the initialized collection supplied to global data.
- [x] Skip automatic rendering and all page-owned output in the writer.
- [x] Preserve explicit inner/full rendering and data-subscription restrictions.
- [x] Preserve independent assets and bundles.
- [x] Add top-level generated-definition `compose` with boolean validation.
- [x] Skip nonexistent output reservations for concrete/generated composition pages.
- [x] Remove var normalization, metadata replacement, and the early-initialization callback.

### Phase 3: Watch lifecycle

- [x] Rebuild subscribed consumers when composition content changes.
- [x] Clean previously owned HTML, sidecars, and `workers.json` when renaming to `.compose`.
- [x] Restore standalone output when renaming back to a normal filename.
- [x] Preserve asset and bundle contents through those renames.
- [x] Refresh collection membership on rename, deletion, and composition-draft changes.
- [x] Handle generated-definition composition toggles and ownership cleanup.
- [x] Keep reports, manifests, caches, and dependency tracking consistent with empty output.

### Phase 4: Tests and documentation

- [x] Add discovery tests across supported filename conventions and draft settings.
- [x] Prove automatic renderers/hooks do not execute for composition pages.
- [x] Prove ordinary vars cannot override discovery-time composition metadata.
- [x] Cover explicit composition, default standalone output, and output collision behavior.
- [x] Add focused watch coverage and public TypeScript contract assertions.
- [x] Add a readable checked-in acceptance site under `test-cases/composition-pages/`.
- [x] Put the main guide under Advanced and link to it briefly from Pages.
- [x] Update data and generated-page documentation.
- [x] Leave `CHANGELOG.md` untouched; it is autogenerated from commits.

### Documentation follow-up in the same PR

- [x] Move detailed page-output hook guidance into Advanced, retaining a short Pages introduction and the layout authoring example.
- [x] Move incremental global-data state and delta indexing into Advanced, retaining a short Data introduction.
- [x] Move build-manifest configuration and integration into an Output manifest guide, retaining a short Workers introduction.
- [x] Consolidate advanced type parameters, layout registry inference, supplied-var checks, and generated-page contracts into Advanced.
- [x] Keep core runtime setup, ordinary typing, Generation, and Implementation as primary references.
- [x] Update cross-references and add tests for checked-in guide navigation, preserved core anchors, and rendered local links.
- [x] Validate the documentation tests, site build, TypeScript checks, and repository-wide lint.

### Phase 5: Validation

- [x] Run focused discovery, generated-page, composition, watch, and acceptance tests.
- [x] Run the full Node test suite.
- [x] Run final TypeScript and repository-wide ESLint validation after test fixtures have finished cleaning up.
- [x] Review the final diff for unrelated changes and temporary artifacts.

## Acceptance criteria

1. A composition source is present in discovery and global data with `pageInfo.compose === true`.
2. A collector can render its body and embed it into a normal homepage.
3. A build does not automatically render the composition page or run its output hooks.
4. Ordinary pages have `pageInfo.compose === false` and continue publishing normally.
5. Static assets and bundles remain usable from the composed homepage.
6. Draft controls determine inclusion, not whether a composition page publishes standalone output.
7. Watch mode rebuilds consumers and cleans/restores output when source filenames change.
8. Types, metadata projections, and documentation agree on the `compose` contract.
9. No variable-cascade override, alternate page class, composition registry, or CLI toggle is introduced.

## Scope boundaries

Do not add automatic child-page stylesheet or script aggregation.
Do not change cargo-like's standalone preview behavior without an explicit request.
Do not add unrelated destination cleanup for ordinary non-clean builds.
Do not hand-edit the changelog or update the lockfile as part of this feature.

## Decision log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-11-02 | Name the feature composition pages. | These remain ordinary pages available for content composition. |
| 2026-11-02 | Initially explored an `emit` page var; superseded by filenames. | Variable precedence made discovery/output eligibility harder to reason about. |
| 2026-11-02 | Use `.compose` and `pageInfo.compose`. | One term and one authoritative discovery-time classification. |
| 2026-11-02 | Keep draft status independent and use `.compose.draft`. | Drafts control inclusion while composition controls automatic output. |
| 2026-11-02 | Generated definitions use top-level `compose`. | Match existing top-level draft metadata without introducing var inheritance. |
| 2026-11-02 | Main docs belong in Advanced. | Pages should link to the specialized guide rather than carry its full details. |
| 2026-11-02 | Do not hand-edit the changelog. | The repository generates it from commits. |
| 2026-11-02 | Move specialized output, incremental-data, and typing guides into Advanced in this PR. | Core references retain concise introductions and links instead of detailed specialist contracts. |

## Validation log

| Date | Command or check | Result |
| --- | --- | --- |
| 2026-11-02 | `git checkout -b composition-pages` | Branch created from a clean `master`. |
| 2026-11-02 | `npm ci --ignore-scripts` | Blocked by existing package.json/lockfile mismatches. |
| 2026-11-02 | `npm install --ignore-scripts --no-package-lock --no-audit --no-fund --fetch-retries=0 --fetch-timeout=30000` | Restored local dependencies without modifying the lockfile. |
| 2026-11-02 | Focused composition/discovery/generated/watch/acceptance tests | 63 tests passed. |
| 2026-11-02 | `npm run test:tsc` | Passed before final formatting cleanup. |
| 2026-11-02 | `node --test` | 879 tests passed; no failures or skips. |
| 2026-11-02 | Repository-wide lint while watch tests were running | Hit a temporary-fixture deletion race; resolved by rerunning after tests completed. |
| 2026-11-02 | `npm run test:tsc && npm run test:neostandard && git --no-pager diff HEAD --check` | All passed after runtime tests completed. |
| 2026-11-02 | Independent implementation review | No concrete correctness or regression issues; focused 63-test suite passed again. |
| 2026-11-02 | Docs navigation, layout, watch, and advanced-guide tests | 20 tests passed, including rendered link and preserved-anchor checks. |
| 2026-11-02 | `npm run build:domstack` after documentation reorganization | Site build passed with all Advanced guides included. |
| 2026-11-02 | `npm run test:tsc && npm run test:neostandard && git --no-pager diff --check` after documentation reorganization | All passed. |

## Implementation notes

Static-copy coverage uses a visible temporary root because the default `.*` ignore excludes the existing test helper's hidden `.tmp-*` root.
This was a fixture issue, not a composition runtime bug.
Normal validation does not require declaration builds.
