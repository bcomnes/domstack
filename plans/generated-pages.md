# Generated Pages Files

## Status: Proposed refinement

Plan for adding first-class generated page support in response to the redirect-page discussion in PR #253.

---

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
  type: 'generated'
  generated: {
    pagesFile: PagesFileInfo
    vars: Record<string, any>
    children: unknown | PageFunction
  }
}
```

Add a generated page builder to `pageBuilders`:

```js
pageBuilders.generated = async ({ pageInfo }) => ({
  vars: pageInfo.generated.vars,
  pageLayout: typeof pageInfo.generated.children === 'function'
    ? pageInfo.generated.children
    : () => pageInfo.generated.children ?? '',
})
```

`PageData.init()` can then continue to resolve layout and assets through the existing builder contract. Generated pages are special only at the point where their `PageInfo` is created.

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
export default function redirectLayout ({ vars }) {
  return `<!DOCTYPE html>
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
</html>`
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
2. Runtime: `resolvePagesFiles()`, generated page validation, generated `PageInfo`, `pageBuilders.generated`.
3. Expansion: create `expandedSiteData` where `pages` contains concrete + generated pages.
4. Pipeline: run `global.data.*`, templates, and page rendering against expanded pages.
5. Errors: duplicate generated/concrete page output conflicts and invalid generated output path errors with useful file context.
6. Tests and docs: generated-pages fixture, README section, redirect and blog-index examples.
7. Watch follow-up: rebuild maps from expanded page data so generated pages participate in layout-targeted rebuilds.
