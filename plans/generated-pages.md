# Generated Pages Files

## Status: Implementation review — ready to land

Plan for adding first-class generated page support in response to the redirect-page discussion in PR #253.

## PR #253 implementation review

Originally reviewed at commit `78d012e` on 2026-08-29. Follow-up fixes were completed during the review.

### Verdict

Ready to land. The worker boundary, generated-output lifecycle, watch behavior, error reporting, public data model, types, and documentation findings have been resolved. Generated pages remain close to regular pages while using a stable source-backed input set plus shared derived data from `global.data.*`.

### Findings

#### 1. Resolved: the documented blog-index example could not be sent back from the worker

`README.md:1107-1117` places concrete `PageData` objects into `vars.posts`. Those objects contain functions such as resolved layout renderers.

Every page's complete vars were added to its output record at `lib/build-pages/page-builders/page-writer.js:109-120`. The worker then tried to send that record back to the main thread at `lib/build-pages/worker.js:9-10`. Functions cannot be sent this way, so the documented example could write its HTML and then reject with a `DataCloneError`.

Generated-page render errors have the same root problem. `lib/build-pages/index.js:560-563` sends the complete generated `PageInfo` as error context, including the function-valued `generated.children` stored at `lib/build-pages/index.js:274-278`. A useful render exception can therefore be replaced by an unclear worker-copy failure.

Implemented resolution:

- Generated pages remain regular `PageInfo` objects handled by the existing JS page builder.
- Rendering functions and complete vars remain available inside the page worker.
- Output records return a snapshot of page vars by copying each top-level value independently. Values that cannot be copied, such as `PageData[]`, are left out of the snapshot.
- Generated page error information omits `generated.vars` and `generated.children` before it is returned from the worker.
- Manifest allowlists and functions continue to use the returned page-vars snapshot in the main thread.
- Regression tests cover the README pattern with `PageData[]` in generated vars, generated render errors, allowlisted manifest vars, and function manifest transforms using post-render values.

#### 2. Resolved: watch mode removes obsolete regular and generated page outputs

One-shot builds assume an empty destination. Watch mode previously rebuilt the pages that currently existed but did not remove files written by pages that had disappeared. This affected regular pages too, although generated pages made it easier to encounter because changing one `*.pages.*` file can rename or remove many outputs.

Implemented resolution:

- The `DomStack` watch instance keeps a set of page output paths from the latest successful full page build.
- After the next successful full page build, it removes previous page files that are no longer claimed by any current page or template output.
- Regular and generated pages use the same cleanup because both emit normal `kind: 'page'` output records.
- Failed and filtered builds do not remove files or replace the saved set because their output lists are incomplete.
- The saved set is replaced after each successful cleanup, so memory use stays proportional to the current number of pages rather than growing across rebuilds.
- Cleanup resolves each recorded path inside the destination and refuses to remove the destination itself.
- Regression coverage includes a regular page removal plus generated output rename, definition removal, transition to `draft: true`, and deletion of the entire `*.pages.*` file.

#### 3. Resolved: conflict detection is intentionally limited to page output paths

The generated-pages design requires generated pages not to replace regular pages or other generated pages. The implementation meets that scope by checking concrete and generated page output paths before rendering.

Templates can still target the same path as a regular or generated page. This is an existing whole-build limitation rather than behavior introduced by generated pages: regular pages and templates could already overwrite one another. Template output paths may also be chosen only after a template runs, while esbuild, static, and copied outputs are written by separate build steps. Manifest reconciliation cannot prevent these conflicts because it runs after files have been written.

Resolved for this PR by:

- Narrowing the PR summary to say it detects conflicts between generated pages and regular or other generated pages.
- Keeping the generated-page checks aligned with the original minimum v1 scope in the “Conflict detection” section below.
- Tracking shared conflict detection across templates and other build steps separately in [issue #288](https://github.com/bcomnes/domstack/issues/288).

A duplicate-record check after the build would be too late to prevent an overwrite, so this PR does not add a partial post-write check.

#### 4. Resolved: layout asset additions rebuild generated HTML in watch mode

For layout CSS or client add events, the watch handler built a filter from `#layoutPageMap`. That map contains only concrete `siteData.pages`, so generated pages were omitted when a concrete and generated page shared the affected layout. The new asset was built, but generated HTML did not gain its `<link>` or `<script>` reference.

Removal already reached the fallback full rebuild because the removed asset was absent from newly identified site data. The add/unlink branch now handles both directions explicitly: whenever any `*.pages.*` files exist, layout asset additions and removals use the same conservative full generated-page rebuild as layout source changes. Sites without pages files keep the targeted regular-page rebuild.

Regression coverage adds and removes both layout CSS and layout clients while a regular and generated page share the layout, and checks that both HTML outputs add and remove the asset references.

#### 5. Resolved: generated-page setup errors keep their type and source context

Errors raised while importing or running a `*.pages.*` file, validating its definitions, or checking its output paths were caught only after the complete generated-pages resolution step. The responsible pages file was no longer known, and wrapping the error for worker transfer removed the output-conflict code and details.

Implemented resolution:

- Generated-page resolution remembers the pages file currently being processed and attaches it to failures before they leave the resolver.
- The worker continues to return a safe plain `Error`, so non-copyable values in a user error's `cause` cannot replace the useful failure with a worker-copy error.
- The existing `errorData` object now carries `pagesFile` plus the output-conflict code and details when applicable.
- The main thread's existing error restoration adds the pages-file name to the message and exposes `pagesFile`, `code`, and `conflict` on the caller-visible error.
- Built-in error names such as `TypeError` are retained.
- Conflict details now identify concrete page source files and generated definitions by `<pages-file>#<index>`, while `conflict.outputPath` separately identifies the duplicated output.
- Regression tests cover a pages function throwing with a non-copyable cause, invalid definitions and paths, generated-to-concrete conflicts, and generated-to-generated conflicts.

#### 6. Resolved: public `siteData.pages` is intentionally discovery-only

Generated pages are downstream of regular page discovery and initialization. Every `*.pages.*` factory receives the same source-backed `PageData[]`; factories do not receive pages produced by earlier pages files. This avoids making generated output depend on pages-file processing order or creating circular page-generation dependencies.

The public `siteData` object remains the result of `identifyPages()`. Its `pages` array therefore contains only source-backed pages discovered from the source tree. `global.data.*` runs from the initialized source-backed pages, and its result is available to every `*.pages.*` factory. Generated pages are then created inside the page worker and combined with regular pages for templates, page functions, layouts, and rendering. They are not added back to the public discovery object.

This keeps one clear `SiteData` meaning rather than introducing separate concrete and expanded variants. It also avoids transferring complete generated `PageInfo` objects from the worker when their definitions can contain functions or other values that cannot be copied between threads.

Implemented resolution:

- Documented the discovery-only meaning on the public `SiteData` type and in the Generated Pages README section.
- Clarified that the `siteData` factory parameter and returned `results.siteData` follow the same rule.
- Renamed the initial build summary count from `Pages:` to `Source pages:`; `Pages built:` continues to include regular and generated pages.
- Added regression coverage confirming returned `results.siteData.pages` contains only the five source-backed fixture pages while generated pages are still built and exposed to downstream render steps.
- Kept watch maps source-backed. Generated-page sites intentionally use full page rebuilds for changes that can alter arbitrary generated outputs.

#### 7. Resolved: generated-pages documentation and public types are complete

The Generated Pages documentation is now a top-level README section rather than part of Templates. It documents:

- All supported `.pages.js`, `.pages.mjs`, `.pages.cjs`, `.pages.ts`, `.pages.mts`, and `.pages.cts` filenames, including the Node.js TypeScript-loading requirement.
- Static object and array exports, normal and async factory functions, and async iterables.
- The `pages`, `vars`, `pagesFile`, and `siteData` factory parameters, including that `vars` contains `global.data.*` output, and when generated pages join the downstream `PageData[]`.
- Every generated definition field, output path rules, asset behavior, and `draft: true` with `--drafts` or `buildDrafts: true`.
- `PagesFunction`, `PagesFunctionParams`, `GeneratedPageDefinition`, and `PagesFileInfo` in the public type catalog.
- Public type imports from `@domstack/static/types.js` rather than the runtime package entry.

The public types were simplified before release:

- `PagesFunction` now explicitly covers normal functions, async functions, and async generators. Its existing return union already describes direct definitions, promises, and async iterables.
- The overlapping `AsyncPagesFunction` was removed instead of adding another `PagesAsyncIterator` type. One factory type accurately describes every supported function form with fewer nearly identical names.
- `PagesFunctionParams` is generic, and `PagesFunction` has a separate third generic for the default/global/global-data vars received by the factory. Generated-page vars and factory input vars can therefore be typed independently.
- `GeneratedPageDefinition.outputName` documents its `<pages-file-name>/index.html` default.
- Type-checked fixtures cover an async generator and separately typed generated/factory vars.
- Runtime coverage confirms static object, static array, and async function exports.

The redirect security warning and meta-refresh SEO guidance remain accurate.

### Objective assessment

The implementation achieves the core design in a clean one-shot build:

- Discovers the intended `*.pages.*` module families.
- Gives every factory a stable view of initialized concrete pages.
- Supports object, array, promise, and async-iterable results.
- Runs generated pages through normal vars, layout, global asset, and manifest processing.
- Makes source-derived global data available to generated-page factories and all pages at final render time.
- Exposes generated pages to templates, page functions, and layouts.
- Validates definitions and output paths.
- Detects generated-to-concrete and generated-to-generated page conflicts.
- Rebuilds generated pages for normal pages-file and imported-dependency changes.

The generated-page build, watch behavior, and public site-data model are now intentional and covered by regression tests. The documented programmatic index builds successfully from collection data returned by `global.data.*`. Runtime-only `PageData[]` values remain available while rendering and are left out of the page-vars snapshot returned from the worker.

#### 8. Resolved: generated pages close issue #237

For now, the generalized generated-pages API is accepted as the resolution of issue #237. It provides the central redirect-page generation requested by the later discussion while keeping redirect output inside the normal page and layout pipeline.

The feature does not add redirect-specific destination validation or native hosting-provider redirect files. Those can be proposed separately if real-world use shows they are needed; they are not required for PR #253 to close #237.

#### 9. Resolved during the final pass: remaining path and watch edge cases

The final complete-diff review found two smaller gaps:

- `outputName: '.'`, `outputName: './'`, and paths ending in a separator passed the initial non-empty check without actually naming an output file. Generated output validation now rejects values that normalize to the current directory or end with a separator.
- Changing `markdown-it.settings.*` rebuilt only source Markdown pages. A generated page that rendered one of those pages could therefore remain stale. Sites with any pages files now use the conservative full generated-page rebuild for Markdown settings changes, while sites without pages files retain the targeted Markdown-only rebuild.

Regression tests cover both cases. Generated drafts also have positive coverage with `buildDrafts: true`, complementing the existing default-omission coverage.

### Landing checklist

- [x] Make generated-page success and error results safe to send from the worker.
- [x] Validate the README index example with a worker-boundary regression test.
- [x] Reconcile and remove obsolete regular and generated page outputs in watch mode.
- [x] Rebuild generated pages when layout assets are added or removed.
- [x] Preserve output-conflict codes, metadata, and pages-file context.
- [x] Define conflict detection as generated-to-regular and generated-to-generated page checks; track whole-build conflicts in issue #288.
- [x] Define returned `siteData.pages` as source-backed discovery data.
- [x] Run `global.data.*` before generated-page factories and expose its result through factory `vars`.
- [x] Finalize generated-pages type names and generics.
- [x] Complete the README API and type documentation.
- [x] Accept the generalized generated-pages feature as closing issue #237.
- [x] Reject generated output paths that do not name a file.
- [x] Refresh generated pages when Markdown settings change.

### Validation performed during review

- `node --test test-cases/generated-pages/index.test.js` — passed (final focused suite: 19 tests).
- `npm run test:node-test` — passed.
- `npm run test:tsc` — passed.
- `npm run test:installed-check` — passed.
- `npm run build:declaration` after cleaning generated declarations — passed.
- Focused ESLint over all changed JavaScript and TypeScript files — passed.
- `git diff --check` — passed.
- Root `npm run test:neostandard` in the review checkout was polluted by malformed fixtures under local `.delta/worktrees`; the equivalent full-repository ESLint command passed with `.delta/**` excluded.
- The original worker-copy reproduction now passes. Obsolete regular and generated page outputs are removed in watch mode, and layout asset additions/removals plus Markdown settings changes now refresh generated HTML. General conflicts between templates and other build steps are tracked separately in issue #288.

---

## Original design plan

## Problem

Templates can already write arbitrary files, including redirect HTML files, `_redirects`, feeds, and other generated assets. They do not, however, create real DomStack pages:

- Template outputs bypass page vars, layouts, default/global assets, and page render helpers.
- Template outputs are not represented in `pages`, so templates, feeds, indexes, and other final-render introspective code cannot see them.
- Redirect pages are conceptually pages: they should use a redirect layout, inherit vars, and appear at page URLs.
- Some generated-page use cases need central control: redirect lists, yearly/monthly blog indexes, tag indexes, pagination, archive pages, etc.

The final PR comments point toward a dedicated `*.pages.ts` feature rather than more redirect docs or more template escape hatches.

## Refined recommendation

Add a generated-pages file type, discovered as `*.pages.*`, but do **not** treat its outputs as a separate output class.

Instead:

> `*.pages.*` files are page factories. They receive collection data derived by `global.data.*`, and their returned definitions expand into normal `PageInfo` entries before templates and final page rendering run.

This preserves the useful authoring model from templates — one file can return one output, many outputs, or an async stream of outputs — while keeping generated results inside the normal page pipeline.

| Feature | Purpose | Output semantics |
|---|---|---|
| `*.template.*` | Generate arbitrary files | Caller provides final file content |
| `*.pages.*` | Generate real pages | Caller provides output name, vars, and children; DomStack renders through layout/page pipeline |

## File naming

Discover the same JS/TS module families as templates:

```txt
*.pages.ts / *.pages.mts / *.pages.cts
*.pages.js / *.pages.mjs / *.pages.cjs
```

Use `nodeHasTS` just like `templateSuffixs` in `lib/identify-pages.js`.

Examples:

```txt
src/redirects.pages.js
src/blog/indexes.pages.ts
src/tags.pages.mjs
```

## Proposed API

A pages file exports a default function, async function, array, object, or async iterable that yields generated page definitions.

```ts
import type { PagesFunction } from '@domstack/static'

export default (async function redirectsPages ({ pages }) {
  return [
    {
      outputName: '2020/old-slug/index.html',
      vars: {
        layout: 'redirect',
        title: 'Redirecting...',
        redirectTo: '/2020/new-slug/',
      },
      children: '',
    },
  ]
}) satisfies PagesFunction
```

The generated page definition is template-like, but layout-driven: `outputName` chooses where to write the page, `children` supplies the layout child content, and `vars` controls page/layout variables.

```ts
type GeneratedPageDefinition<Vars = Record<string, any>, Children = any> = {
  outputName?: string // default: '<pages-file-name>/index.html'
  vars?: Vars
  children?: Children | ((params: PageFunctionParams<Vars, Children>) => Children | Promise<Children>)
  draft?: boolean
}
```

Rules:

- `outputName` is a relative output path, resolved from the `*.pages.*` file's directory, with no leading `/` and no `..` segments.
- `outputName` defaults to `<pages-file-name>/index.html`.
- `vars.layout` participates in normal layout resolution. If omitted, the usual default/global layout value applies.
- `children` can be static content or an inline page-like render function.
- Generated pages must not reference another page file as their render template.
- Generated pages intentionally do not get page-local assets (`style.css`, `client.js`, workers). They only participate in global and layout assets.

## Pages file parameters

Pass enough context for reflection while avoiding circular or ordering-dependent generation:

```ts
type PagesFunctionParams = {
  pages: PageData[]
  vars: Record<string, any>
  pagesFile: PagesFileInfo
  siteData: SiteData
}
```

`pages` contains only concrete/source-backed pages discovered directly from the source tree, initialized with default/global/page/builder vars and the values returned by `global.data.*`. It does not include generated pages from any `*.pages.*` file, including pages produced by earlier files in the same build.

`vars` contains default vars, `global.vars.*`, and the collection data returned by `global.data.*`. This gives every pages file the same stable introspection set and derived-data input.

## Build pipeline

Do not run `*.pages.*` files inside `identifyPages()`. They need initialized concrete page data (`page.vars`, builder vars, pageInfo, render helpers), and `identifyPages()` should remain a file-discovery phase.

Instead, add an explicit page-expansion phase early in `buildPagesDirect()`.

Current pipeline:

```txt
identifyPages()
  discover concrete pages
  discover layouts/templates/global assets

buildPagesDirect()
  resolve default/global vars
  resolve layouts
  initialize concrete PageData[]
  resolve global.data.* with concrete pages
  stamp globalDataVars
  render pages and templates
```

Proposed pipeline:

```txt
identifyPages()
  discover concrete pages
  discover layouts/templates/global assets
  discover pagesFiles (*.pages.*)

buildPagesDirect()
  resolve default/global vars
  resolve layouts

  concretePageInfos = siteData.pages
  concretePageData = initialize concrete PageData[]

  resolve global.data.* with concretePageData
  stamp globalDataVars onto concretePageData

  run pagesFiles with concretePageData + global/globalData vars + siteData
  validate generated page definitions
  convert definitions into generated PageInfo objects
  detect output conflicts against concrete pages and earlier generated pages

  generatedPageData = initialize generated PageData[]
  stamp globalDataVars onto generatedPageData
  allPages = [...concretePageData, ...generatedPageData]

  render pages/templates using siteData + allPages
```

The important framing is that `global.data.*` derives shared collection data from concrete pages, then generated outputs become ordinary pages built from that source data. Final page rendering and templates operate on the combined page list, while public `siteData` and watch maps remain source-backed.

## Data model changes

### `identify-pages.js`

Add:

```js
export const pagesSuffixs = nodeHasTS
  ? ['.pages.ts', '.pages.mts', '.pages.cts', '.pages.js', '.pages.mjs', '.pages.cjs']
  : ['.pages.js', '.pages.mjs', '.pages.cjs']
```

Add `PagesFileInfo` and `siteData.pagesFiles` alongside `siteData.templates`.

Optionally distinguish the raw concrete pages from expanded pages once expansion has run:

```ts
type SiteData = {
  pages: PageInfo[]          // expanded pages after generated-page expansion
  concretePages?: PageInfo[] // source-backed pages discovered by identifyPages()
  pagesFiles: PagesFileInfo[]
}
```

`identifyPages()` can initially return `pages` and `concretePages` as the same list. The expansion phase can then produce an `expandedSiteData` object rather than mutating the original `siteData` in place.

### Generated page info

Represent generated pages as regular `PageInfo` entries with an additional marker:

```ts
type GeneratedPageInfo = PageInfo & {
  type: 'js'
  generated: {
    pagesFile: PagesFileInfo
    vars: Record<string, any>
    children: unknown | PageFunction
  }
}
```

Let the existing JS page builder consume the in-memory generated payload before
falling back to importing a concrete JS page module:

```js
if (pageInfo.generated) {
  return {
    vars: pageInfo.generated.vars,
    pageLayout: typeof pageInfo.generated.children === 'function'
      ? pageInfo.generated.children
      : () => pageInfo.generated.children ?? '',
  }
}
```

Generated pages then follow the same `PageData` initialization and rendering
path as concrete JavaScript pages. Generated vars and functions stay inside the
page worker while rendering. When the worker returns its build report, it copies
each top-level page var independently and leaves out values that cannot be
copied. Generated page error information similarly leaves out `vars` and
`children`.

## Conflict detection

Generated pages must not silently overwrite concrete pages, loose markdown outputs, or other generated pages. Any duplicate generated/concrete page output path must throw a conflict error.

Minimum v1 conflict checks:

1. Validate `outputName` is relative and cannot escape the pages file's directory.
2. Compute:
   - `outputRelname = join(pagesFile.path, outputName)`
   - `path = dirname(outputRelname)`
   - `outputName = basename(outputRelname)`
   - `url = computePageUrl({ path, outputName })`
3. Reject duplicates within:
   - existing concrete `siteData.pages[*].outputRelname`
   - generated definitions from all pages files

Prefer hard errors for duplicate page output paths, matching the existing duplicate page-source behavior.

## Watch mode integration

Generated pages should eventually make watch mode cleaner, not more special, if watch maps are rebuilt from expanded page data.

### Conservative v1

Treat `*.pages.*` as structural page inputs:

- Add/change/unlink of a `*.pages.*` file → full page rebuild and rebuild maps.
- Dependency of a `*.pages.*` file → full page rebuild.
- Layout changes may need a full page rebuild until generated pages are included in layout watch maps.

### Better follow-up

Once the build has an `expandedSiteData` concept, rebuild watch maps from expanded pages:

- `#layoutPageMap` should include generated pages by resolving their final `vars.layout`.
- A layout change can then target both concrete and generated pages using that layout.
- `#pageFileMap` can include generated page pseudo-file paths only if targeted rebuilds need them; otherwise pages-file changes remain structural.
- `#pagesFileDepMap` tracks dependencies imported by pages files and can conservatively trigger full page rebuilds.

This avoids the current broad special case of “if any pages files exist, layout changed means rebuild all pages.”

## Public types

Export from the dedicated `types.js` type entry:

- `PagesFunction` for normal, async, and async-generator factories
- `PagesFunctionParams`
- `GeneratedPageDefinition`
- `PagesFileInfo`

Add JSDoc typedefs first, then declaration generation will expose them through the existing `tsc -p declaration.tsconfig.json` flow.

## Documentation examples

### Redirects

```md
---
title: Current Post
redirectFrom:
  - /2020/old-slug/
---
```

```js
// global.data.js validates destination-page metadata and derives `{ from, to }`.
export default function ({ pages }) {
  const redirects = []
  const redirectOwners = new Map()
  for (const page of pages) {
    const redirectFrom = page.vars.redirectFrom
    if (redirectFrom === undefined) continue

    const source = page.pageInfo.pageFile.relname
    if (!Array.isArray(redirectFrom)) throw new TypeError(`redirectFrom on "${source}" must be an array`)
    for (const from of redirectFrom) {
      if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) throw new Error(`Invalid redirectFrom on "${source}"`)
      const existingSource = redirectOwners.get(from)
      if (existingSource) throw new Error(`redirectFrom "${from}" is declared by both "${existingSource}" and "${source}"`)
      redirectOwners.set(from, source)
      redirects.push({ from, to: page.pageInfo.url })
    }
  }
  return { redirects }
}

// redirects.pages.js turns the derived collection into normal pages.
export default function ({ vars }) {
  const pages = []
  for (const { from, to } of vars.redirects) {
    const relativePath = from.slice(1)
    pages.push({
      outputName: relativePath.endsWith('/') ? `${relativePath}index.html` : relativePath,
      vars: {
        layout: 'redirect',
        title: 'Redirecting...',
        redirectTo: to,
      },
    })
  }
  return pages
}
```

```js
// src/redirect.layout.js
import { html, render } from 'fragtml'

export default function redirectLayout ({ vars }) {
  return render(html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${vars.redirectTo}">
  <link rel="canonical" href="${vars.redirectTo}">
  <title>${vars.title}</title>
</head>
<body>
  <p>Redirecting to <a href="${vars.redirectTo}">${vars.redirectTo}</a></p>
</body>
</html>`)
}
```

Redirect metadata validation happens in `global.data.*` while the destination source page is known. It rejects malformed metadata, unsafe paths, and duplicate old URLs with source-specific errors. The generated-output validator remains a second path-safety check.

### Blog indexes

```js
// src/blog-indexes.pages.js
export default function ({ vars }) {
  const years = new Set()
  const indexes = []

  for (const post of vars.blogPosts) {
    const year = new Date(post.publishDate).getUTCFullYear().toString()
    if (years.has(year)) continue

    years.add(year)
    indexes.push({
      outputName: `blog/${year}/index.html`,
      vars: { layout: 'blog-index', title: `${year} posts` },
    })
  }

  return indexes
}
```

## Tests

Add a focused generated-pages fixture, likely `test-cases/generated-pages/`:

1. Discovers `*.pages.js` and exposes it on `siteData.pagesFiles`.
2. Collects destination-page `redirectFrom` metadata in `global.data.js` and generates redirect pages through a `redirect.layout.js`.
3. `global.data.js` receives source-backed pages, and its returned collection data is available to pages factories and template vars.
4. Generated blog/year indexes can use collection data derived from concrete pages.
5. Multiple `*.pages.*` files each receive only concrete pages, not generated pages from other pages files.
6. Duplicate generated/concrete output paths throw an aggregate build error.
7. Invalid generated output paths (`/absolute`, `../escape`, `nested/../../escape`) throw a clear error.
8. Async iterable pages files work for large output sets.
9. Watch mode: changing a `*.pages.js` file triggers a full page rebuild.
10. Follow-up watch test: once expanded watch maps exist, a layout change rebuilds generated pages using that layout.

Run at minimum:

```sh
npm run test:node-test -- test-cases/generated-pages/index.test.js
npm run test:neostandard
npm run test:tsc
```

Then run full `npm test` before merging.

## Design decisions

1. `*.pages.*` files are page factories, not a separate output system.
   - Their outputs become regular `PageInfo` entries in the expanded page list.
   - Downstream systems should consume the expanded page list wherever possible.
2. Generated pages are distinct from concrete/source-backed pages only while pages files are running.
   - The `pages` argument passed to `*.pages.*` files contains only concrete pages discovered directly from the source tree.
   - Generated pages are not passed to other pages files in the same build.
   - This avoids ordering-dependent generation.
3. Generated pages do not support page-level `style.css`, `client.js`, or workers.
   - They participate only in global assets and layout assets.
   - This keeps generated pages focused on central page creation while concrete pages remain the place for page-local asset bundles.
4. Generated pages pass child content directly; they do not pull in existing page files as render templates.
   - `children` may be static content or an inline render function.
   - Reusable presentation belongs in layouts or userland helper functions imported by the pages file.

## Milestones

1. Discovery and types: `pagesSuffixs`, `PagesFileInfo`, `siteData.pagesFiles`, exported JSDoc typedefs.
2. Runtime: `resolvePagesFiles()`, generated page validation, and generated `PageInfo` support in the JS page builder.
3. Data flow: run `global.data.*` from concrete pages and pass its result to generated-page factories.
4. Expansion: combine concrete and generated pages for templates and final page rendering.
5. Errors: duplicate generated/concrete page output conflicts and invalid generated output path errors with useful file context.
6. Tests and docs: generated-pages fixture, README section, redirect and blog-index examples.
7. Watch follow-up: use conservative full page rebuilds when generated outputs may change; keep targeted source-page maps for sites without pages files.
