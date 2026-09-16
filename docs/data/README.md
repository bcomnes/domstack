---
layout: docs
docsOrder: 80
handlebars: false
---

# Data

Collect shared values from source pages in `global.data.ts`, then let each page, layout, or generator subscribe to exactly the values it needs.
This pipeline powers indexes, navigation, feeds, and other derived content without giving every renderer access to the entire page collection.
For output definitions, see [Generation](../generation/); for ordinary configuration defaults, see [Settings](../settings/#global.vars.ts).

## Table of Contents

[[toc]]

## Global data

The `global.data.ts` file is an optional file that can live anywhere in your `src` tree.
The first one found wins and duplicates warn.
Its callback runs **once each time DOMStack builds pages**, after [source-backed pages](../pages/#page-files) are initialized and before generated-page factories run.

> [!NOTE]
> `global.data.js` works too.
See [Supported file types](../typescript/#supported-file-types) for all available extensions.

For data that aggregates across multiple pages — like blog indexes, sitemaps, recent-post lists, or RSS feed content — use `global.data.ts`.
It is the only public build hook that receives the source-backed `PageData[]` collection.
It returns an object of named, top-level values that downstream consumers can explicitly subscribe to.
The default export can be an object or a synchronous or asynchronous function that returns one.

```typescript
// src/global.data.ts
import type { AsyncGlobalDataFunction } from '@domstack/static/types.js'
import { html, render } from 'fragtml'

export type GlobalData = {
  blogPostsHtml: string
}

export type ArchiveData = Pick<GlobalData, 'blogPostsHtml'>

const buildGlobalData: AsyncGlobalDataFunction<GlobalData> = async ({ pages }) => {
  const blogPosts: typeof pages = []
  for (const page of pages) {
    if (page.vars.layout === 'blog' && page.vars.publishDate) {
      blogPosts.push(page)
    }
  }
  blogPosts.sort((a, b) => new Date(b.vars.publishDate).valueOf() - new Date(a.vars.publishDate).valueOf())

  const entries = []
  for (const page of blogPosts.slice(0, 5)) {
    entries.push(html`
      <li class="blog-entry h-entry">
        <a class="blog-entry-link u-url u-uid p-name" href="${page.pageInfo.url}">
          ${page.vars.title}
        </a>
      </li>
    `)
  }

  const blogPostsHtml = render(html`
    <ul class="blog-index-list">
      ${entries}
    </ul>
  `)

  return { blogPostsHtml }
}

export default buildGlobalData
```

## Data subscriptions

The returned object is not merged into `vars`.
A page or layout declares the keys it needs through `dataDeps`, then reads those keys from the separate `data` argument:

```md
<!-- src/page.md -->
---
dataDeps:
  - blogPostsHtml
---

## [Blog](./blog/)

{{{ data.blogPostsHtml }}}
```

HTML pages declare the same field in an adjacent `page.vars.ts` file:

```typescript
// src/archive/page.vars.ts
export default {
  dataDeps: ['blogPostsHtml'],
}
```

TypeScript pages and layouts can put the declaration in their `vars` export:

```typescript
import type { DataDeps, PageFunction } from '@domstack/static/types.js'
import type { ArchiveData } from './global.data.js'

export const vars = {
  dataDeps: ['blogPostsHtml'] satisfies DataDeps<ArchiveData>,
}

const archivePage: PageFunction<Record<string, never>, string, ArchiveData> = ({ data }) =>
  `<h1>Archive</h1>${data.blogPostsHtml}`

export default archivePage
```

Keep these focused consumer contracts beside the complete global-data type so pages and layouts can import a meaningful name instead of reconstructing a `Pick<GlobalData, ...>` selection.
`DataDeps<Contract>` checks declaration names against that contract and accepts readonly arrays, including `as const` tuples.
The declaration is still required at runtime; a TypeScript type alone does not subscribe a renderer.

For `*.template.ts` and `*.pages.ts` files, export `dataDeps` as a named module export because those files do not have consumer vars:

```typescript
export const dataDeps = ['blogPostsHtml']

export default function archiveTemplate ({ data }) {
  return data.blogPostsHtml
}
```

`dataDeps` is build metadata and is removed from the resolved `vars` object.
The page receives the union of its own frontmatter, page-vars, and builder declarations.
Each layout receives only its own `vars.dataDeps`, not its parent's or the page's data.
For output invalidation, DOMStack unions the page's declarations with those of every layout in its resolved `parentLayout` chain.
Children do not repeat ancestor declarations, and a parent's subscriptions cannot be cleared by a child's empty declaration.
When one layout calls another layout function directly, the composing layout must declare every global-data key the composed rendering needs.

**Key properties of `global.data.ts`:**

- **Centralizes page collation and processing.** Collect, filter, group, sort, and render source pages once, then expose purpose-built values instead of the page graph itself.
- Receives source-backed `PageData[]` with resolved `.vars` (global, layout, page, and builder vars), `.pageInfo` (path, type, etc.), `.styles`, `.scripts`, and more.
  Generated pages do not exist yet.
- Gives pages, layouts, templates, and page factories only their declared top-level keys through `data`.
- Keeps global data separate from ordinary `vars`, so derived values cannot silently collide with page or layout configuration.
- Runs inside the worker process (same as all other dynamic imports) to avoid ESM caching issues.
- During targeted watch rebuilds, DOMStack compares each top-level returned value with the previous build and also rebuilds consumers subscribed to values that changed.
- Editing `global.data.*` or its watched imports recomputes the shared data.
- Values composed of JSON-safe primitives, arrays, and plain objects get stable fingerprints; opaque values such as functions, class instances, maps, sets, or cycles conservatively invalidate their subscribers on every page build.
- A declaration naming a missing key fails the build, and access to an existing but undeclared key throws a focused error.

Subscription failures use `DomStackDataError` with code `DOM_STACK_ERROR_DATA`.
Its `dataDependency` metadata identifies the consumer, optional key, and reason: `INVALID_DECLARATION`, `MISSING_KEY`, `UNDECLARED_KEY`, or `NOT_READY`.
The subtype and metadata survive worker transport inside the build's aggregate errors.
After a failed watch build, the next page build retries the complete page phase before returning to incremental routing.

## Global data types

`GlobalDataFunction<T>` accepts synchronous or asynchronous implementations; `AsyncGlobalDataFunction<T>` specifically requires a promise.
In both types, `T` describes the named data returned by `global.data.ts`:

```typescript
// src/global.data.ts
import type { GlobalDataFunction } from '@domstack/static/types.js'

type DerivedData = {
  pageCount: number
  pageUrls: string[]
}

const globalData: GlobalDataFunction<DerivedData> = ({ pages }) => {
  return {
    pageCount: pages.length,
    pageUrls: pages.map(page => page.pageInfo.url),
  }
}

export default globalData
```

Use `AsyncGlobalDataFunction<DerivedData>` instead when the implementation needs to await rendering, network requests, or other asynchronous work.
For typed source input, use `GlobalDataFunction<Result, SourceVars, SourceContent>` or its async counterpart.
Helpers can accept `GlobalDataFunctionParams<SourceVars, SourceContent>['pages']` without recovering types from the full global-data result.
For callbacks that cache results between watch builds, see [Incremental global data](#incremental-global-data).

## Global data caveats

Source-page introspection must not mutate resolved variables or depend on the data it is still computing.
The following rules keep that build order explicit.

> [!CAUTION]
> `page.vars` is a cached, shallow-frozen object containing the resolved variable cascade.
Treat it as read-only.
Create a new object when you need to add or replace values.

```typescript
// src/global.data.ts
// Do not mutate the resolved page variables.
page.vars.slug = createSlug(page.vars.title)

// Create a new object instead.
const derivedVars = {
  ...page.vars,
  slug: createSlug(page.vars.title),
}
```

> [!WARNING]
> Accessing `page.vars` throws when that page failed to initialize, such as when a page-variable module contains a syntax error, missing dependency, or runtime error.
Fix the underlying page initialization failure rather than treating missing variables as valid data.

> [!NOTE]
> Raw Markdown is not exposed as `page.vars.content`.
Markdown variables include frontmatter-derived values such as `title`.
Call `readMarkdownContent()` when you need the source body.

```typescript
// src/global.data.ts
const markdownSources = await Promise.all(
  pages
    .filter(page => page.pageInfo.type === 'md')
    .map(async page => ({
      path: page.pageInfo.path,
      markdown: await page.readMarkdownContent(),
    }))
)
```

> [!TIP]
> `global.data.ts` can call `renderInnerPage()` because it runs after source-backed page initialization has been attempted.
> The same initialization caveat applies.

```typescript
// src/global.data.ts
const renderedPages = await Promise.all(
  pages.map(async page => ({
    path: page.pageInfo.path,
    html: await page.renderInnerPage(),
  }))
)
```

Global-data computation cannot read the `data` values it is still producing.
If a source page declares data dependencies, attempting to render it from `global.data.ts` fails rather than creating a hidden cycle.

See [Rendering page content](#rendering-page-content) for rendering semantics and performance guidance.

## Page data and introspection

Page functions and layouts, including those rendering generated pages, receive metadata for the current page through `page`.
Only `global.data.ts` receives the collection of source-backed `PageData` instances.
This is the intentional boundary between source-page introspection and downstream rendering.

```typescript
// src/example/page.ts
export default function examplePage ({ page }) {
  console.log(page.url)
  return ''
}
```

Generated-page factories do not receive `PageData`.
They consume values explicitly returned by `global.data.ts` instead.

### Page metadata

The current `page` is a `PageInfo` object with the following properties:

- `type`: The page type (`md`, `html`, or `js`).
- `path`: The source-relative directory path for the page.
- `url`: The canonical URL path, such as `/blog/my-post/` for index pages or `/blog/loose-page.html` for loose pages.
- `outputName`: The final output filename.
- `outputRelname`: The destination-relative output path.
- `pageFile`: Source-file path details.
- `pageStyle`: File information when the page has a page style.
- `clientBundle`: File information when the page has a client bundle.
- `pageVars`: File information when the page has an adjacent page-variable file.
- `generated`: Metadata about the `*.pages.ts` file that created a generated page, or `undefined` for a source-backed page.

Each `PageData` entry supplied to `global.data.ts` exposes this object as `page.pageInfo`.
When caching entries by source page, use `page.sourceId` as the key and `page.pageInfo.url` as the output URL.
Combine `page.pageInfo.url` with a `siteUrl` from `global.vars.ts` to build an absolute URL: `` `${vars.siteUrl}${page.pageInfo.url}` ``.
The [RSS and JSON feed recipe](../cookbook/feeds/) uses this pattern for feed item URLs.

### Inspecting layout variables

Prefer the resolved variable cascade for normal application code: `page.vars` on a `PageData` instance in `global.data.ts`, or the `vars` argument in page and layout renderers.
It includes the effective values from all sources, so your code respects layout defaults and page overrides.
The result is cached and shallow-frozen, with a shallow merge in this order: global → each layout (outermost to innermost) → page → builder. Later values override earlier ones.

`page.layoutVars` is an escape hatch for cases where you specifically need an individual layout's contribution, such as debugging where a value came from.
Reading a layer directly bypasses the rest of the cascade, so its value may differ from the one used during rendering.
It contains one entry per layout, ordered from outermost to innermost:

- `name`: The registered layout name.
- `vars`: That layout's resolved variables, excluding its `dataDeps` declaration. A layout without variables has an empty object.

The type is `Array<{ name: string, vars: Partial<T> }>`, where `T` describes the page's variables.
Each entry preserves its own values, even when a later layout or the page overrides them.
For example, if a root layout supplies `theme: 'light'` and an article layout supplies `theme: 'dark'`, both contributions are available in `page.layoutVars`.

Read `page.vars.theme` to respect the cascade: the effective theme in this example is `'dark'` unless page or builder variables override it.

```typescript
// Inside global.data.ts, where pages contains PageData instances.
for (const page of pages) {
  console.log(page.pageInfo.url, 'resolved title:', page.vars.title)
  // Inspect individual contributions only when diagnosing the cascade.
  for (const { name, vars } of page.layoutVars) {
    console.log(name, 'layout title:', vars.title)
  }
}
```

### Rendering page content

Each `PageData` instance passed to `global.data.ts` exposes two methods for accessing rendered output.
This is useful when derived data needs to embed a page's content, such as the [`global.data.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/global.data.ts) implementation used by the [RSS and JSON feed recipe](../cookbook/feeds/).

- `await page.renderInnerPage()` returns the page's inner render output as produced by its builder, without a layout wrapper applied.
  This is often an HTML string, such as Markdown rendered to HTML, but the type depends on the page builder.
- `await page.renderFullPage()` returns the complete page output with its layout applied.

Both methods are async, and rendering errors propagate and fail the build.
While `global.data.ts` is resolving, `renderInnerPage()` is allowed if the page itself has no subscriptions, even when its layouts subscribe to data.
`renderFullPage()` requires the page and its entire layout chain to be unsubscribed at that stage, because derived data does not exist yet.

### Rendering many pages

Use [`global.data.ts`](#global-data) to pre-render content shared by multiple downstream pages or templates.
This centralizes the work and makes the result available through an explicit subscription:

```typescript
// src/global.data.ts
import type { AsyncGlobalDataFunction } from '@domstack/static/types.js'

const globalData: AsyncGlobalDataFunction = async ({ pages }) => {
  const entries = await Promise.all(
    pages.map(async page => [
      page.pageInfo.path,
      await page.renderInnerPage()
    ] as const)
  )

  return { renderedPagesByPath: Object.fromEntries(entries) }
}

export default globalData
```

Rendering performed inside `global.data.ts` cannot use the derived values that the same file is still computing.
After `global.data.ts` returns, consumers receive only the values named by their `dataDeps` declarations.

## Incremental global data

> [!NOTE]
> Most sites do not need incremental global data.
> Start with a regular `global.data.ts` callback and consider incremental indexing when a large number of pages makes watch rebuilds slow.

An incremental index caches results for each source page so you can update affected entries instead of processing every page on every watch rebuild.
Keep the index in saved state and return the shared values your pages need, such as a navigation list.
Saved state is private to the callback; it is not exposed through `data`.

The callback receives four fields:

- `pages`: All current source pages, excluding generated pages.
- `previousState`: A copy of your saved state, or `undefined` when starting fresh.
  You can modify it, but must call `setState` to save your updates.
- `changes`: On `kind: 'reset'`, rebuild the index from `pages`.
  On `kind: 'delta'`, update entries for the new or affected pages in `changes.upserted` and delete the IDs in `changes.removed`.
- `setState(next)`: Take a snapshot of your index to reuse on the next build.
  DOMStack keeps that snapshot only if the current build succeeds.

Use `page.sourceId` as the index key: a read-only source-relative path such as `docs/data/README.md`, using `/` separators on every platform.
`changes.removed` contains these same IDs.

### Simple documentation index

This example caches titles and URLs for Markdown pages under `/docs/` and returns a sorted navigation list.

```typescript
// src/global.data.ts
import type { GlobalDataFunctionParams } from '@domstack/static/types.js'

type SourceVars = { title?: string }
type Entry = { title: string, url: string }
type Index = Map<string, Entry>

export default function ({
  pages, previousState, changes, setState,
}: GlobalDataFunctionParams<SourceVars, string, Index>) {
  let index: Index
  let inputs: typeof pages
  switch (changes.kind) {
    case 'reset':
      index = new Map()
      inputs = pages
      break
    case 'delta':
      index = previousState ?? new Map()
      inputs = previousState === undefined ? pages : changes.upserted
      for (const sourceId of changes.removed) index.delete(sourceId)
      break
    default:
      throw new Error('Unhandled global-data changes', { cause: changes satisfies never })
  }

  for (const page of inputs) {
    const { url, type } = page.pageInfo
    if (type !== 'md' || !url.startsWith('/docs/')) {
      index.delete(page.sourceId)
      continue
    }
    index.set(page.sourceId, { title: page.vars.title ?? url, url })
  }

  setState(index)
  return {
    docsNavigation: [...index.values()].sort((a, b) => a.url.localeCompare(b.url)),
  }
}
```

A layout subscribes with `export const vars = { dataDeps: ['docsNavigation'] }` and reads `data.docsNavigation`.
If you edit a Markdown page without changing its title or URL, the navigation stays the same, so other pages do not rebuild just because they subscribe to it.
For an example that also caches heading links, see the [documentation site's index](https://github.com/bcomnes/domstack/blob/master/site/globals/global.data.ts).

The third type argument in `GlobalDataFunctionParams<SourceVars, SourceContent, State>` describes the saved state—`Index` in this example.
For `GlobalDataFunction` and `AsyncGlobalDataFunction`, `State` is the fourth type argument, after the result, source-vars, and source-content types.
It defaults to `unknown`.
Helpers that process `changes` can use the exported `GlobalDataChanges` type.

### Usage notes

- State lasts for one watch session, not across process restarts.
  Always handle `changes.kind === 'reset'`, including after failed builds.
- Source-page edits and tracked helper changes can update individual entries.
  Changes to `global.data.*` or settings inputs reset the saved index.
- Store structured-cloneable values such as plain records, arrays, or maps—not `PageData` instances, functions, or native objects with shared mutable storage.
- A page can appear in `changes.upserted` even when its content is unchanged.
  Replace its cached entry, or delete it if the page no longer belongs in your index.
- Relative static imports within the watched source tree are tracked, including imported JSON.
  Restart watch mode after changing files read with `fs.readFile()`, environment variables, or other inputs outside page dependency tracking.
- Static re-exports (`export … from`) are not followed by dependency tracking ([#328](https://github.com/bcomnes/domstack/issues/328)).
  Use an explicit import followed by a local export, or restart watch mode after those dependencies change.
