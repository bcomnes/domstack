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
Its callback runs **once per page build**, after [source-backed pages](../pages/#page-files) are initialized and before generated-page factories run.

> [!NOTE]
> `global.data.js` works too.
See [Supported file types](../typescript/#supported-file-types) for all available extensions.

For data that aggregates across multiple pages — like blog indexes, sitemaps, recent-post lists, or RSS feed content — use `global.data.ts`.
It is the only public build hook that receives the source-backed `PageData[]` collection.
It returns an object of named, top-level values that downstream consumers can explicitly subscribe to.
Existing synchronous or asynchronous callbacks that accept only `({ pages })` remain supported, as do static default object exports such as `export default { siteName: 'My site' }`.
Incremental state is opt-in and does not change the meaning of the returned object.

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

## Incremental global data

In watch mode, a global-data callback can retain explicit state to avoid repeating expensive indexing work for unchanged source pages.
The callback receives `{ pages, previousState, changes, setState }`:

- `pages` is the complete current, initialized source-backed `PageData[]` collection, not just the pages selected for output rendering.
  Generated pages are not included, and source membership respects discovery and draft eligibility.
- `previousState` is an isolated clone of the state retained from the last successful build, or `undefined` on reset or when no state was retained.
- `setState(next)` immediately clones and stages an explicit state value for the next successful build.
  The last call wins; later mutations to `next` do not alter that snapshot.
  Mutating `previousState` alone does not stage an update: without `setState`, a delta retains the old state and a reset leaves state undefined.
- `changes` is a discriminated union describing source inputs, independently of output-render filters:
  - `{ kind: 'reset', reason: string, events: WatchEvent[] }` means rebuild your state from all of `pages`.
    It has no `upserted` or `removed` fields.
  - `{ kind: 'delta', upserted: PageData[], removed: string[], events: WatchEvent[] }` supplies current initialized pages whose inputs were invalidated or which became newly eligible, plus source IDs no longer eligible.
    Upserts are conservative input invalidations, not a guarantee that rendered content changed.

Use the read-only `page.sourceId` getter as the identity for an upsert, for example `docs/data/README.md`.
It is `page.pageInfo.pageFile.relname` normalized relative to the source root, with `/` separators on every platform and no checkout-specific prefix.
`changes.removed` contains the same source IDs, not absolute paths, URLs, or output filenames.
IDs distinguish identical filenames in different directories and stay the same when the checkout moves; a source rename is a removal plus an upsert.
The absolute `page.pageInfo.pageFile.filepath` remains available for filesystem operations.
Treat an upsert as replacement of that source's cached record and a removal as deletion of that key.
If an upsert stops matching your own index filter, delete its cached record too.

Both variants expose the existing raw `WatchEvent` objects through `changes.events`, with `type`, `filepath`, `name`, and `convention` fields.
Raw event `filepath` values and internal dependency paths remain absolute; do not use them as keys in a source-ID-keyed index.
The event list preserves batch order, duplicates, and removals rather than becoming a deduplicated page-change list; the initial reset has an empty event list.
Use `changes.kind`, `upserted`, and `removed` to update an index rather than reconstructing page membership from raw events.

### Retained state and resets

State must be structured-cloneable: plain data, arrays, `Map`, `Set`, `Date`, and other isolated values supported by `structuredClone` are suitable.
`SharedArrayBuffer` and views backed by shared memory are rejected because cloning them does not isolate their bytes; copy them into non-shared storage first.
Store extracted records, not `PageData` instances, functions, or renderers; uncloneable state passed to `setState` throws an actionable error.
State is private to the producer and separate from its ordinary returned data, so a retained `Map` does not itself participate in public-data fingerprints or subscriptions.
State is session-local, not a persistent disk cache or retained module globals.

Rebuild from `pages` on every reset, regardless of the diagnostic `reason` string.
Resets cover the initial build and a new or restarted watch session, changes to the global-data producer or its tracked static imports, global vars or their tracked imports, Markdown settings or their tracked imports, broader global configuration changes, unknown or unreliable events, and recovery after build or dependency-analysis failure.
A reset always supplies `previousState: undefined`, even if an earlier build had retained state.

Only a successful page/template phase, including generated pages, followed by successful cleanup commits the staged state and source-membership baseline.
Returning from `global.data.ts` or calling `setState` does not commit it early.
A failed build does not advance that baseline; the next page build resets and recomputes instead of trusting a partial candidate.
This protects retained state, not filesystem outputs: output writes and deletions are not transactional and are not rolled back after failure.

### Simple documentation index

This self-contained example caches each Markdown documentation page's title and URL, then returns a sorted navigation list.
It uses only initialized page metadata: no Markdown rendering, HTML parsing, or search service is needed.

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

A reset fills the index from all pages; a delta replaces affected entries and removes deleted or newly ineligible pages.
The exhaustive switch makes TypeScript flag any unhandled change kind.
`previousState` is already isolated, so the delta can update that map directly; `setState(index)` stages a cloned snapshot.
A consuming layout declares `export const vars = { dataDeps: ['docsNavigation'] }` and reads `data.docsNavigation`.
Sorting by URL makes the public navigation independent of map insertion order, and unchanged navigation fingerprints leave its subscribers untouched.
Caching title and URL alone is inexpensive either way; the example demonstrates the state flow, while the real site below also caches extracted headings.

### How this documentation site uses the index

DOMStack's own `site/globals/global.data.ts` retains an index keyed by `page.sourceId` of documentation titles, heading anchors, and ordering/group/parent metadata.
Only upserted documentation pages are rendered and parsed; removed or newly ineligible sources are dropped from the index.
The navigation helpers in `site/layouts/docs/navigation.js` then regenerate the ordered, nested `docsNavigation` and `docsIndexHtml` from those plain records without rendering Markdown again.
Parent/child nesting is assembled on fresh entries rather than mutating cached heading arrays, so repeated builds do not accumulate children and deletions or parent changes take effect immediately.
A body-only edit updates one record, but unchanged TOC fingerprints prevent other documentation pages from rebuilding.

### Tracking, batching, and performance limits

Dependency tracking covers relative static ESM imports and re-exports in the non-ignored watched source tree, including imported JSON files.
It does not automatically track bare-package internals, CommonJS `require()`, dynamic imports, arbitrary filesystem reads, network responses, environment variables, or other dynamic inputs.
When those inputs change, explicitly invalidate the relevant source input (or the producer for a full state reset), or restart the watch session; do not assume a raw event or a cached record discovers the change.

Watch events can be batched while a build is running, and subsequent builds converge on the current source tree.
A batch is not a snapshot of filesystem contents at event time, and an intermediate build may observe newer contents before queued events are processed.
Write index updates as replacements and deletions that tolerate repeated invalidations, not as exactly-once event operations.

Incremental indexing can reduce the producer's Markdown rendering work, but it does not make the entire build O(changed pages).
All source pages are still initialized, retained state is cloned, and returned data is still fingerprinted; the example also sorts the complete index on each callback.
For an index that renders Markdown, a counter around `renderInnerPage()` measures indexing render calls only, not total source-page initialization, downstream rendering, or filesystem output writes.
Those are separate stages, and rendering an output does not necessarily write it when its bytes are unchanged.

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
- No producer callback runs if no `global.data.*` file exists.
- In watch mode, DOMStack fingerprints each top-level returned value and rebuilds only consumers subscribed to changed keys.
- Editing `global.data.*` or one of its tracked statically imported helpers in the watched source tree resets retained state and recomputes data; a shared helper also rebuilds its direct page, layout, template, and factory consumers.
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
For retained state, add the final generic: `GlobalDataFunction<Result, SourceVars, SourceContent, State>`, `AsyncGlobalDataFunction<Result, SourceVars, SourceContent, State>`, or `GlobalDataFunctionParams<SourceVars, SourceContent, State>`.
`State` defaults to `unknown`; existing result and source generic positions are unchanged.
`GlobalDataChanges`, `GlobalDataResetChanges`, `GlobalDataDeltaChanges`, and `WatchEvent` are also exported from `@domstack/static/types.js`.
Manually constructed `GlobalDataFunctionParams` objects must include `previousState`, `changes`, and `setState`, even though callbacks may ignore those fields.

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
The read-only `page.sourceId` getter provides its normalized source-relative file identity directly, without traversing `pageInfo`; it is distinct from the output URL.
Generated `PageData` instances use their synthetic factory relname (such as `archive.pages.ts#0`), but are not part of the global-data source collection.
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
