---
layout: docs
handlebars: false
---

# Data

Collect shared values from source pages in `global.data.ts`, then let each page, layout, or generator subscribe to exactly the values it needs.
This pipeline powers indexes, navigation, feeds, and other derived content without giving every renderer access to the entire page collection.
For output definitions, see [Generation](../generation/); for ordinary configuration defaults, see [Settings](../settings/#globalvarsts).

## Table of Contents

[[toc]]

## Global data

The `global.data.ts` file is an optional file that can live anywhere in your `src` tree.
The first one found wins and duplicates warn.
It runs **once per build**, after [source-backed pages](../pages/#page-files) are initialized and before generated-page factories run.

> [!NOTE]
> `global.data.js` works too.
See [Supported file types](../typescript/#supported-file-types) for all available extensions.

For data that aggregates across multiple pages — like blog indexes, sitemaps, recent-post lists, or RSS feed content — use `global.data.ts`.
It is the only public build hook that receives the source-backed `PageData[]` collection.
It returns an object of named, top-level values that downstream consumers can explicitly subscribe to.

```typescript
// src/global.data.ts
import type { AsyncGlobalDataFunction } from '@domstack/static/types.js'
import { html, render } from 'fragtml'

export type GlobalData = {
  blogPostsHtml: string
}

export type ArchiveData = Pick<GlobalData, 'blogPostsHtml'>

const buildGlobalData: AsyncGlobalDataFunction<GlobalData> = async ({ pages }) => {
  const blogPosts = pages
    .filter(p => p.vars?.layout === 'blog' && p.vars?.publishDate)
    .sort((a, b) => new Date(b.vars.publishDate) - new Date(a.vars.publishDate))
    .slice(0, 5)

  const blogPostsHtml = render(html`
    <ul class="blog-index-list">
      ${blogPosts.map(p => html`
        <li class="blog-entry h-entry">
          <a class="blog-entry-link u-url u-uid p-name" href="${p.pageInfo.url}">
            ${p.vars?.title}
          </a>
        </li>
      `)}
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
- Skipped entirely if no `global.data.*` file exists — zero overhead.
- In watch mode, DOMStack fingerprints each top-level returned value and rebuilds only consumers subscribed to changed keys.
- Editing `global.data.*` or one of its statically imported helpers recomputes data; a shared helper also rebuilds its direct page, layout, template, and factory consumers.
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
Combine `page.pageInfo.url` with a `siteUrl` from `global.vars.ts` to build an absolute URL: `` `${vars.siteUrl}${page.pageInfo.url}` ``.
The [RSS and JSON feed recipe](../cookbook/#generate-rss-and-json-feeds) uses this pattern for feed item URLs.

### Rendering page content

Each `PageData` instance passed to `global.data.ts` exposes two methods for accessing rendered output.
This is useful when derived data needs to embed a page's content, such as the [`global.data.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/global.data.ts) implementation used by the [RSS and JSON feed recipe](../cookbook/#generate-rss-and-json-feeds).

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
