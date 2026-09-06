---
handlebars: false
---

# Content generation reference

[Home](../../) · [Documentation](../)

## Table of Contents

[[toc]]

## Global data

The `global.data.ts` file is an optional file that can live anywhere in your `src` tree.
The first one found wins and duplicates warn.
It runs **once per build**, after [source-backed pages](../../docs/pages/#pages) are initialized and before generated-page factories run.

> [!NOTE]
> `global.data.js` works too.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions.

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
- Receives fully resolved source-backed `PageData[]` — every page has `.vars` (merged global + page + builder vars), `.pageInfo` (path, type, etc.), `.styles`, `.scripts`, and more.
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

### Global data types

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

### Global data caveats

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

See [Rendering page content](../../docs/content/#rendering-page-content) for rendering semantics and performance guidance.

## Generated Pages

Generated-pages files create one or more DOMStack pages from a central `*.pages.*` module.
Unlike templates, generated pages use the normal page and layout pipeline: each definition supplies page variables and children, which DOMStack renders through the selected layout.
Use generated pages for data-driven output such as blog index pages or HTML redirects derived from frontmatter.

Generated-pages files use the `*.pages.ts` suffix.

> [!NOTE]
> Wherever you see `*.pages.ts` being used, you can also use `*.pages.js`.
Type checking is supported in both file types.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions.

### Generated-pages exports

Like [variable providers](../../docs/pages/#variable-providers), generated-page factories may be synchronous or asynchronous.
Unlike variable providers, they return page definitions and may produce multiple results.

A generated-pages module can default-export:

| Export | Use when |
|---|---|
| One `GeneratedPageDefinition` object | The module always creates one page |
| An array of definitions | The module always creates a fixed set of pages and needs no build context |
| A normal or `async` function | Definitions depend on global vars, declared global data, or pages-file metadata |
| An async iterable, usually returned by `async function*` | Pages are discovered incrementally or the total is not known in advance |

Static objects and arrays do not receive factory parameters.

#### One page definition

Export one object when the module always creates a single page:

```ts
// src/about.pages.ts
export default {
  outputName: 'about/index.html',
  vars: { layout: 'root', title: 'About' },
  children: '<p>About this site</p>',
}
```

#### Page definition array

Export an array when the module always creates a fixed set of pages:

```ts
// src/legal.pages.ts
export default [
  {
    outputName: 'terms/index.html',
    vars: { layout: 'legal', title: 'Terms' },
    children: 'Terms of service',
  },
  {
    outputName: 'privacy/index.html',
    vars: { layout: 'legal', title: 'Privacy' },
    children: 'Privacy policy',
  },
]
```

#### Synchronous factory

Export a function when definitions depend on declared global data or shared variables:

```ts
// src/tag-indexes.pages.ts
export const dataDeps = ['tagIndex']

export default function tagIndexes ({ data }) {
  return Object.entries(data.tagIndex).map(([tag, posts]) => ({
    outputName: `tags/${tag}/index.html`,
    vars: { layout: 'tag-index', title: `Posts tagged ${tag}`, posts },
  }))
}
```

For a complete two-stage factory example, see [Generate yearly blog index pages](../../docs/cookbook/#generate-yearly-blog-index-pages).

#### Asynchronous factory

Export an async function when creating definitions requires asynchronous work:

```ts
// src/team.pages.ts
import { readFile } from 'node:fs/promises'

export default async function teamPages () {
  const members = JSON.parse(
      await readFile(new URL('./data/team.json', import.meta.url), 'utf8')
    )

  return members.map(member => ({
    outputName: `team/${member.slug}/index.html`,
    vars: { layout: 'profile', title: member.name, member },
  }))
}
```

#### Async iterable

Export an async generator when pages should be yielded incrementally:

```ts
// src/archive.pages.ts
export const dataDeps = ['blogYears']

export default async function * archivePages ({ data }) {
  for (const year of data.blogYears) {
    yield {
      outputName: `blog/${year}/index.html`,
      vars: { layout: 'archive', year },
    }
  }
}
```

### Generated-pages factory parameters

Functions receive one object with:

| Parameter | Contents |
|---|---|
| `vars` | Default and global vars. |
| `data` | Only the top-level values named by the module's `dataDeps` export. |
| `pagesFile` | Information about the current file. `name` is the filename without its `.pages.*` suffix, `path` is its source-relative directory, and `pagesFile` contains the underlying file information. |

Factories do not receive raw source or generated `PageData` collections.
Put page-collection logic in `global.data.ts`, return a focused serializable value, and subscribe to its key from the factory.
This keeps factories downstream of source discovery without exposing generation order or creating page-generation cycles.

### Generated page definitions

| Field | Behavior |
|---|---|
| `outputName` | Output path relative to the pages file's directory. It must name a file, must not be absolute or contain `..` segments, and cannot end in a path separator. Defaults to `<pages-file-name>/index.html`. |
| `vars` | Page-level vars merged with the normal default, global, layout, and builder vars. |
| `children` | Optional static child content or inline `PageFunction` rendered before the layout. |
| `draft` | When `true`, the page is omitted unless the CLI uses `--drafts` or a programmatic build uses `buildDrafts: true`. |

Generated pages use [global assets](../../docs/assets/#global-assets) and [layout assets](../../docs/pages/#layout-styles).
They do not have page-local `style.css`, `client.js`, or worker entries because they do not have their own source-page directory.

### Generated-pages types

Use `GeneratedPageDefinition<T, U, D>` to type an individual definition.
`T` is the generated page's variables type, `U` is its children type, which defaults to `string`, and `D` is the declared data shape for inline page functions:

```ts
// src/terms.pages.ts
import type { GeneratedPageDefinition } from '@domstack/static/types.js'

type LegalPageVars = {
  layout: string
  title: string
}

const terms: GeneratedPageDefinition<LegalPageVars> = {
  outputName: 'terms/index.html',
  vars: { layout: 'legal', title: 'Terms' },
  children: 'Terms of service',
}

export default terms
```

Use `PagesFunction<T, U, V, D>` for normal functions, async functions, and async generators:

- `T` is the variables type added to each generated page.
- `U` is the generated children type (defaults to `string`).
- `V` is the default and global vars type received by the factory.
- `D` is the global-data shape declared by the factory.

```ts
// src/archive.pages.ts
import type { PagesFunction } from '@domstack/static/types.js'

type ArchiveVars = { layout: string, year: number }
type ArchiveData = { blogYears: number[] }

export const dataDeps = ['blogYears']

const archivePages: PagesFunction<ArchiveVars, string, Record<string, never>, ArchiveData> = async function * ({ data }) {
  for (const year of data.blogYears) {
    yield {
      outputName: `blog/${year}/index.html`,
      vars: { layout: 'archive', year },
    }
  }
}

export default archivePages
```

For metadata-driven redirects, see the cookbook recipe [Generate redirect pages from page metadata](../../docs/cookbook/#generate-redirect-pages-from-page-metadata).

## Templates

Template files let you write any kind of file type to the `dest` folder while customizing the contents with global vars and explicitly subscribed global data.
Template files can be located anywhere in the `src` directory.
For a complete feed-generation recipe, see [Generate RSS and JSON feeds](../../docs/cookbook/#generate-rss-and-json-feeds).

Template files look like:

```bash
name-of-template.txt.template.ts
${name-portion}.template.ts
```

Template files are `.ts` files that default-export one of the following sync/async functions:

> [!NOTE]
> Wherever you see `.template.ts` being used, you can also use `.template.js`.
Type checking is supported in both file types.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions.

### Simple string template

A function that returns a string.
The `name-of-template.txt` portion of the template file name becomes the file name of the output file.

```typescript
// name-of-template.txt.template.ts
import type { TemplateFunction } from '@domstack/static/types.js'

interface TemplateVars {
  foo: string;
  testVar: string;
}

const simpleTemplate: TemplateFunction<TemplateVars> = async ({
  vars: {
    foo,
    testVar
  }
}) => {
  return `Hello world

This is just a file with access to global vars: ${foo}`
}

export default simpleTemplate
```

### Object template

A function that returns a single object with a `content` and `outputName` entries.
The `outputName` overrides the name portion of the template file name.

```typescript
import type { TemplateFunction } from '@domstack/static/types.js'

interface TemplateVars {
  foo: string;
}
export default async ({
  vars: { foo }
}) => ({
  content: `Hello world

This is just a file with access to global vars: ${foo}`,
  outputName: './single-object-override.txt'
})
```

### Object array template

A function that returns an array of objects with a `content` and `outputName` entries.
This template file generates more than one file from a single template file.

```typescript
import type { TemplateFunction } from '@domstack/static/types.js'

interface TemplateVars {
  foo: string;
  testVar: string;
}

const objectArrayTemplate: TemplateFunction<TemplateVars> = async ({
  vars: {
    foo,
    testVar
  }
}) => {
  return [
    {
      content: `Hello world

This is just a file with access to global vars: ${foo}`,
      outputName: 'object-array-1.txt'
    },
    {
      content: `Hello world again

This is just a file with access to global vars: ${testVar}`,
      outputName: 'object-array-2.txt'
    }
  ]
}

export default objectArrayTemplate
```

### AsyncIterator template

An [AsyncIterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncIterator) that `yields` objects with `content` and `outputName` entries.

```typescript
import type { TemplateAsyncIterator } from '@domstack/static/types.js'

interface TemplateVars {
  foo: string;
  testVar: string;
}

const templateIterator: TemplateAsyncIterator<TemplateVars> = async function * ({
  vars: {
    foo,
    testVar
  }
}) {
  // First item
  yield {
    content: `Hello world

This is just a file with access to global vars: ${foo}`,
    outputName: 'yielded-1.txt'
  }

  // Second item
  yield {
    content: `Hello world again

This is just a file with access to global vars: ${testVar}`,
    outputName: 'yielded-2.txt'
  }
}

export default templateIterator
```

Templates receive only global vars, their declared global `data`, and metadata for the current template.
Use `global.data.ts` to turn source-page collections into values a template can subscribe to.

### Choosing a template return type

Use the simplest return type that fits your needs:

| Return type | Multiple outputs | Custom output path | Buffers the output set | Use when |
|---|---|---|---|---|
| String | No | No (derived from template filename) | — | Single file, output path derived from template filename |
| Object | No | Yes | — | Single file with a custom output path |
| Array | Yes | Yes | Yes | Fixed set of output files known at build time |
| AsyncIterator | Yes | Yes | No | Dynamic or unknown number of outputs, or when outputs should be yielded incrementally without buffering the full set |

Start with a string return and only switch to a more complex type when you need what it provides.
All template forms can do async work (string, object, and array all support `async` functions).
Choose AsyncIterator specifically when the number of output files is not known until the template runs, or when you want to stream outputs one at a time rather than building the full list in memory first.


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
The [RSS and JSON feed recipe](../../docs/cookbook/#generate-rss-and-json-feeds) uses this pattern for feed item URLs.

### Rendering page content

Each `PageData` instance passed to `global.data.ts` exposes two methods for accessing rendered output.
This is useful when derived data needs to embed a page's content, such as the [`global.data.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/global.data.ts) implementation used by the [RSS and JSON feed recipe](../../docs/cookbook/#generate-rss-and-json-feeds).

- `await page.renderInnerPage()` returns the page's inner render output as produced by its builder, without a layout wrapper applied.
  This is often an HTML string, such as Markdown rendered to HTML, but the type depends on the page builder.
- `await page.renderFullPage()` returns the complete page output with its layout applied.

Both methods are async, and rendering errors propagate and fail the build.
While `global.data.ts` is resolving, `renderInnerPage()` is allowed if the page itself has no subscriptions, even when its layouts subscribe to data.
`renderFullPage()` requires the page and its entire layout chain to be unsubscribed at that stage, because derived data does not exist yet.

### Rendering many pages

Use [`global.data.ts`](../../docs/content/#global-data) to pre-render content shared by multiple downstream pages or templates.
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

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
