# DOMStack v12 release review

This document records the issues found while reviewing `12.0.0-beta.2` before the stable v12 release.

## Release blockers

### Watch builds can leave collection consumers stale

A targeted source-page rebuild recalculates `global.data`, but it only writes the directly affected page.
Other pages, templates, and generated pages may consume values derived from the changed page and remain stale.

This was reproduced with two Markdown pages and a `global.data.js` value derived from all page titles.
After changing one title, that page received the new collection value while the other page retained the old value.

The invalidation rule must account for these dependency paths:

- A rendered page may consume values returned by `global.data`.
- A template may consume source pages, generated pages, or global data.
- A generated-pages factory may consume source pages or global data.
- A layout may inspect the complete page collection.
- `readMarkdownContent()`, `renderInnerPage()`, and `renderFullPage()` create content dependencies between outputs.

Blanket rebuilding every consumer would be correct but would defeat the purpose of granular rebuilds.
The proposed direction is described in [Output-level watch dependency tracking](#output-level-watch-dependency-tracking).

### Layout watch mapping ignores builder vars and Markdown frontmatter

The watcher's page-to-layout map currently resolves only default, global, and `page.vars.*` values.
Actual page initialization also resolves builder variables, including Markdown frontmatter.

This was reproduced with a Markdown page that selects `layout: blog` through frontmatter.
Changing `blog.layout.js` did not rebuild that page, and its output remained byte-for-byte unchanged.

Successful page build reports already include the fully resolved `layoutName`.
The watcher should persist that result instead of independently approximating layout selection.

### Published declarations do not pass strict consumer validation

The published `12.0.0-beta.2` tarball was installed into a clean TypeScript consumer using NodeNext resolution and `skipLibCheck: false`.
Its declarations failed under TypeScript 5.9 and TypeScript 6.0.

The DOMStack-owned declaration errors are emitted for `htmlBuilder` and `mdBuilder`.
Their return types reference an undeclared generic named `T`.

The public declaration graph also exposes declaration errors from `cpx2`.
TypeScript 5.9 additionally reports a Markdown declaration incompatibility.

The repository's `skipLibCheck: true` setting masks these failures.
Release validation should pack the package, install it in a clean fixture, and type-check that fixture with `skipLibCheck: false`.

## Other findings

### Offline examples extend a nonexistent TypeScript configuration

Both new offline examples extend `../tsconfig.json`, but there is no `examples/tsconfig.json`.
They should extend `../../tsconfig.json`, matching the other examples.

The example build exits successfully while esbuild reports the missing configuration as a warning.
This means the examples currently build without their intended shared compiler settings.

Affected files:

- `examples/static-mpa-offline/tsconfig.json`
- `examples/static-mpa-workbox-offline/tsconfig.json`

### Production dependency audit reports a high-severity advisory

`npm audit --omit=dev` reports `deepmerge-ts <8.0.0` through the direct `write-package` dependency.
`write-package` is used only by the eject command.

The advisory concerns stack exhaustion while merging recursive object graphs, so exposure through parsed `package.json` data appears limited.
There is no automatic npm fix.
Replacing `write-package` or implementing the small package update directly would remove the known advisory from the production dependency graph.

## Output-level watch dependency tracking

The proposed watch design persists a dependency graph produced by successful renders.

Every source page, generated-page owner, template, and rendered output receives a stable identity.
The `pages` collection and page variable objects passed to user code are wrapped in read-tracking proxies.
An async-local render context attributes observed reads to the active consumer even when builds run concurrently.

The graph should represent dependencies such as:

- A template read source page A's `vars.title`.
- A generated-pages factory called source page B's `readMarkdownContent()`.
- A rendered page read the `blogIndexes` value returned by `global.data`.
- A layout iterated the page collection and therefore depends on collection membership and order.

The page worker returns dependency records with its normal successful build report.
`DomStack` retains those records and replaces a consumer's records only after that consumer builds successfully.

`global.data` already runs during a targeted page build.
The worker can fingerprint each top-level returned value and compare those fingerprints with the previous successful build.
Only consumers that read changed keys need invalidation.

Page arrays need two levels of tracking.
Iteration records a dependency on collection membership and order, while reads from an individual `PageData` record dependencies on that page.
Adding or removing a page invalidates collection consumers, while an ordinary edit invalidates consumers that observed the changed page.

Values that cannot be fingerprinted safely should use a conservative fallback.
That fallback should rebuild the affected consumer class rather than every site output.

User code may read files, network data, environment variables, or other state behind DOMStack's back.
An explicit escape hatch such as `export const watchDependencies = 'all'` or a dependency callback should support those cases.

### Experimental branch status

The `fix/v12-watch-dependency-tracking` branch contains a first implementation of this design.

The experiment currently:

- Uses one `WatchDependencyTracker` instance per page-worker build.
- Uses async-local context to attribute concurrent reads without sharing state between workers.
- Sends plain dependency records through the existing worker result.
- Persists the last successful records in the main `DomStack` instance.
- Tracks individual page variable properties, page metadata, render-helper calls, and top-level global-data keys.
- Fingerprints observed values and invalidates only consumers whose observed values changed.
- Rebuilds generated-page owners that observed changed page values.
- Removes obsolete generated outputs when dependency invalidation changes an owner's output names.
- Uses successful page reports as the source of truth for page-to-layout mapping.
- Keeps dependency proxies out of one-shot production builds.

Render-helper calls are currently treated as opaque dependencies and invalidate conservatively when their source page changes.
Collection membership does not need incremental comparison yet because page additions and removals already take the structural full-rebuild path.
File, network, environment, and other external reads remain untracked and still need an explicit invalidation API.
Targeted template builds still use the existing template-output cleanup behavior and may need owner-based obsolete-output cleanup as a separate improvement.

## Validation completed during review

- The repository was clean and synchronized with `origin/master`.
- The current HEAD GitHub test workflow was green.
- `npm test` passed the installed dependency check, ESLint, Node tests, Playwright, and TypeScript.
- `npm run build` passed.
- `npm run build-examples` passed with the two TypeScript configuration warnings described above.
- The actual published `12.0.0-beta.2` tarball was inspected and runtime-imported successfully.
- Clean tarball consumers were checked with TypeScript 5.9 and TypeScript 6.0.
- The production dependency audit was run.
- Both watch correctness bugs were independently reproduced.
