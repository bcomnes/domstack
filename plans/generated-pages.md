# Generated Pages Files

## Status: Implementation review — changes requested

Plan for adding first-class generated page support in response to the redirect-page discussion in PR #253.

## PR #253 implementation review

Reviewed commit `78d012e` on 2026-08-29.

### Verdict

Do not land PR #253 yet. The core design is sound and the clean-build happy path works, but the current implementation has worker-boundary and generated-output lifecycle problems that should be fixed first. Watch behavior, error reporting, and public documentation also need another pass.

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

#### 6. Design gap: generated pages are not added to public `siteData.pages`

Generated pages exist only in the worker-local array at `lib/build-pages/index.js:513-514`. The returned `results.siteData.pages` remains the concrete discovery list from `lib/identify-pages.js:612-628`.

This differs from the expanded-site model later in this plan and means:

- Programmatic `results.siteData.pages` is concrete-only.
- Watch maps remain concrete-only and require broad generated-page special cases.
- The initial `Pages:` build total excludes generated pages, although `Pages built:` includes them.
- No generated `PageInfo` graph is available to programmatic callers after the build.

Either implement an explicit `expandedSiteData`/`concretePages` model or deliberately define and document `siteData.pages` as discovery-only. Add a test that locks in the chosen public behavior.

#### 7. Documentation and public types need another pass

In addition to fixing the broken primary example:

- Promote Generated Pages from a Templates subsection to its own top-level feature section.
- Document static object and array exports, async functions, async iterables, and all supported module suffixes.
- Document the `vars`, `pagesFile`, and `siteData` factory parameters.
- Document generated `draft: true` behavior and its relationship to `--drafts`/`buildDrafts`.
- Add `PagesFunction`, `AsyncPagesFunction`, `PagesFunctionParams`, `GeneratedPageDefinition`, and `PagesFileInfo` to the README type catalog.
- Import public types from `@domstack/static/types.js`, not the package root.
- Correct the `GeneratedPageDefinition.outputName` JSDoc to say it defaults to `<pages-file-name>/index.html`.
- Revisit `AsyncPagesFunction`: its required `Promise` return cannot annotate the supported `async function*` form in `test-cases/generated-pages/src/async.pages.js`. A `PagesAsyncIterator` type aligned with `TemplateAsyncIterator` would be clearer.
- Consider making `PagesFunctionParams` generic so incoming global vars can be typed separately from generated page vars before the public API is frozen.

The redirect security warning and meta-refresh SEO guidance are accurate.

### Objective assessment

The implementation achieves the core design in a clean one-shot build:

- Discovers the intended `*.pages.*` module families.
- Gives every factory a stable view of initialized concrete pages.
- Supports object, array, promise, and async-iterable results.
- Runs generated pages through normal vars, layout, global asset, and manifest processing.
- Exposes generated pages to global data, templates, page functions, and layouts.
- Validates definitions and output paths.
- Detects generated-to-concrete and generated-to-generated page conflicts.
- Rebuilds generated pages for normal pages-file and imported-dependency changes.

The objective is still only partially complete in watch mode and in the public data model. The documented programmatic index now builds successfully: its `PageData[]` remains available while rendering and is left out of the page-vars snapshot returned from the worker.

PR #253 says it closes issue #237. The generalized page-factory mechanism satisfies the later PR discussion, but the original issue also asks for native redirect declarations and target-existence validation. This implementation does not validate redirect destinations or natively emit hosting-provider redirect configuration. Either explicitly accept this generalized API as the resolution of #237 or leave the issue open for those remaining capabilities.

### Landing checklist

- [x] Make generated-page success and error results safe to send from the worker.
- [x] Validate the README index example with a worker-boundary regression test.
- [x] Reconcile and remove obsolete regular and generated page outputs in watch mode.
- [x] Rebuild generated pages when layout assets are added or removed.
- [x] Preserve output-conflict codes, metadata, and pages-file context.
- [x] Define conflict detection as generated-to-regular and generated-to-generated page checks; track whole-build conflicts in issue #288.
- [ ] Decide whether returned `siteData.pages` is concrete-only or expanded.
- [ ] Finalize generated-pages type names and generics.
- [ ] Complete the README API and type documentation.
- [ ] Decide whether this generalized feature fully closes issue #237.

### Validation performed during review

- `npm run test:node-test -- test-cases/generated-pages/index.test.js` — passed.
- `npm run test:node-test` — passed.
- `npm run test:tsc` — passed.
- `npm run build:declaration` after cleaning generated declarations — passed.
- Focused ESLint over all changed JavaScript and TypeScript files — passed.
- `git diff --check` — passed.
- Root `npm run test:neostandard` in the review checkout was polluted by malformed fixtures under ignored `.delta/worktrees`, not by PR changes.
- The original worker-copy reproduction now passes. Obsolete regular and generated page outputs are removed in watch mode, and layout asset additions/removals now refresh generated HTML. General conflicts between templates and other build steps are tracked separately in issue #288.

---

## Original design plan

## Problem

Templates can already write arbitrary files, including redirect HTML files, `_redirects`, feeds, and other generated assets. They do not, however, create real DomStack pages:

- Template outputs bypass page vars, layouts, default/global assets, and page render helpers.
- Template outputs are not represented in `pages`, so `global.data.*`, feeds, indexes, and other introspective code cannot see them.
- Redirect pages are conceptually pages: they should use a redirect layout, inherit vars, and appear at page URLs.
- Some generated-page use cases need central control: redirect lists, yearly/monthly blog indexes, tag indexes, pagination, archive pages, etc.

The final PR comments point toward a dedicated `*.pages.ts` feature rather than more redirect docs or more template escape hatches.

## Refined recommendation

Add a generated-pages file type, discovered as `*.pages.*`, but do **not** treat its outputs as a separate output class.

Instead:

> `*.pages.*` files are page factories. Their returned definitions expand into normal `PageInfo` entries and are appended to the page set before `global.data.*`, templates, and final page rendering run.

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

`pages` contains only concrete/source-backed pages discovered directly from the source tree, initialized with default/global/page/builder vars, but before `global.data.*` runs. It does not include generated pages from any `*.pages.*` file, including pages produced by earlier files in the same build.

This gives every pages file the same stable introspection set.

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

  run pagesFiles with concretePageData + global vars + siteData
  validate generated page definitions
  convert definitions into generated PageInfo objects
  detect output conflicts against concrete pages and earlier generated pages

  expandedSiteData = {
    ...siteData,
    concretePages: concretePageInfos,
    pages: [...concretePageInfos, ...generatedPageInfos],
  }

  generatedPageData = initialize generated PageData[]
  allPages = [...concretePageData, ...generatedPageData]

  resolve global.data.* with allPages
  stamp globalDataVars onto allPages
  render pages/templates using expandedSiteData + allPages
```

The important framing is that generated outputs become ordinary pages as soon as they have been expanded into `GeneratedPageInfo` objects. From that point forward, rendering, global data, templates, reports, and watch maps should operate on the expanded page list.

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

Export from `index.js`:

- `PagesFunction`
- `AsyncPagesFunction`
- `PagesFunctionParams`
- `GeneratedPageDefinition`
- `PagesFileInfo`

Add JSDoc typedefs first, then declaration generation will expose them through the existing `tsc -p declaration.tsconfig.json` flow.

## Documentation examples

### Redirects

```js
// src/redirects.pages.js
const redirects = [
  { from: '2020/old-slug', to: '/2020/new-slug/' },
]

export default function () {
  return redirects.map(({ from, to }) => ({
    outputName: `${from}/index.html`,
    vars: {
      layout: 'redirect',
      title: 'Redirecting...',
      redirectTo: to,
    },
  }))
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

Docs should still mention validating redirect targets, but that security note belongs in the redirect-layout example rather than in the generated-pages core API.

### Blog indexes

```js
// src/blog-indexes.pages.js
export default function ({ pages }) {
  const years = new Map()

  for (const page of pages) {
    const date = page.vars.publishDate
    if (!date || !page.pageInfo.path.startsWith('blog/')) continue
    const year = new Date(date).getFullYear().toString()
    years.set(year, [...(years.get(year) ?? []), page])
  }

  return [...years].map(([year, posts]) => ({
    outputName: `blog/${year}/index.html`,
    vars: { layout: 'blog-index', title: `${year} posts`, posts },
  }))
}
```

## Tests

Add a focused generated-pages fixture, likely `test-cases/generated-pages/`:

1. Discovers `*.pages.js` and exposes it on `siteData.pagesFiles`.
2. Generates redirect pages that render through a `redirect.layout.js`.
3. Generated pages appear in `global.data.js` and in template `pages` introspection.
4. Generated blog/year indexes can inspect concrete pages.
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
3. Expansion: create `expandedSiteData` where `pages` contains concrete + generated pages.
4. Pipeline: run `global.data.*`, templates, and page rendering against expanded pages.
5. Errors: duplicate generated/concrete page output conflicts and invalid generated output path errors with useful file context.
6. Tests and docs: generated-pages fixture, README section, redirect and blog-index examples.
7. Watch follow-up: rebuild maps from expanded page data so generated pages participate in layout-targeted rebuilds.
