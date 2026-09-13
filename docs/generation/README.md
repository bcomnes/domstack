---
layout: docs
docsOrder: 90
handlebars: false
---

# Generation

Create output from code when a source file per page is not the right fit.
Generated pages use DOMStack's normal page and layout pipeline, while templates write arbitrary files such as feeds, JSON, or text.
Both can subscribe to shared values prepared by the [data pipeline](../data/).

| Use | Choose | Result |
|---|---|---|
| Archives, tag indexes, or HTML redirects with page variables and layouts | `*.pages.ts` | One or more DOMStack pages |
| Feeds, sitemaps, JSON, text, or fully controlled output | `*.template.ts` | One or more files, without layout wrapping |
| An ordinary page with its own source directory and browser assets | [Page files](../pages/#page-files) | A source-backed page |
| Markdown downloads, JSON metadata, or other extra files owned by a source-backed page | [`pageOutputs`](../pages/#page-outputs) | Extra files alongside the page's HTML |

## Table of Contents

[[toc]]

## Generated pages

Generated-pages files create one or more DOMStack pages from a central `*.pages.*` module.
Unlike templates, generated pages use the normal page and layout pipeline: each definition supplies page variables and children, which DOMStack renders through the selected layout.
Use generated pages for data-driven output such as blog index pages or HTML redirects derived from frontmatter.

Generated-pages files use the `*.pages.ts` suffix.

> [!NOTE]
> Wherever you see `*.pages.ts` being used, you can also use `*.pages.js`.
Type checking is supported in both file types.
See [Supported file types](../typescript/#supported-file-types) for all available extensions.

### Generated-pages exports

Like [variable providers](../pages/#variable-providers), generated-page factories may be synchronous or asynchronous.
Unlike variable providers, they return page definitions and may produce multiple results.

A generated-pages module can default-export:

| Export | Use when |
|---|---|
| One `GeneratedPageDefinition` object | The module always creates one page |
| An array of definitions | The module always creates a fixed set of pages and needs no build context |
| A normal or `async` function | Definitions depend on global vars, declared global data, or pages-file metadata |
| An async iterable, usually returned by `async function*` | Pages are discovered incrementally or the total is not known in advance |

Static objects and arrays do not receive factory parameters.
A `null` or `undefined` default export or factory result produces no pages, as does an empty array or async iterable.
Each array entry or yielded value must still be a page-definition object; `null` entries are not skipped.

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

For a complete two-stage factory example, see [Generate yearly blog index pages](../cookbook/yearly-blog-indexes/).

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

#### Streaming and failures

DOMStack consumes generated pages one at a time rather than collecting all definitions before building them.
For each definition, it validates the definition and output path, initializes the page's variables, layouts, and declared data, then renders and writes the HTML before requesting the next definition.
An async generator resumes after `yield` only once that page has been written, so it can release resources associated with the completed page before preparing the next one.
Arrays and single-object results use the same per-page pipeline, although an array-producing factory necessarily creates its array before returning it.

Definitions marked `draft: true` are skipped unless drafts are enabled.
Skipped drafts retain their position in source identifiers: after a skipped first definition, the next page is identified as `archive.pages.ts#1`, not `archive.pages.ts#0`.
Output paths must be unique across generated pages and must not collide with source-backed pages.
Do not rely on the processing order of sibling factory modules.

A factory, validation, initialization, or render failure stops the active iterator without requesting later definitions.
Async generators can use `try`/`finally` to release resources when iteration stops.
Earlier completed pages remain written; generated-page builds are not transactional, and a late failure does not roll back earlier HTML.
Conflict errors still identify both sources even when one page has already been written.
Build results retain output metadata and the owning pages-file path for completed pages, including when the build fails.

In watch mode, failed builds retain both previously owned outputs and any newly written partial outputs without stale-output cleanup.
A later successful rebuild removes obsolete outputs, including partial pages from repeated failures or an initially failed watch build.
Removing the factory or changing it to return no pages also cleans up its tracked outputs after a successful rebuild.
This ownership tracking does not require a public DOMStack manifest and does not remove outputs still owned by sibling factories.

### Generated-pages factory parameters

Functions receive one object with:

| Parameter | Contents |
|---|---|
| `vars` | Default and global vars. |
| `data` | Only the top-level values named by the module's `dataDeps` export. |
| `pagesFile` | Information about the current file. `name` is the filename without its `.pages.*` suffix, `path` is its source-relative directory, and `pagesFile` contains the underlying file information. |

Factories do not receive raw source or generated `PageData` collections.
Put page-collection logic in [`global.data.ts`](../data/#global-data), return a focused serializable value, and subscribe to its key from the factory.
Source-backed pages remain fully initialized before `global.data.ts` runs, so it can inspect their resolved variables and use their rendering methods subject to the normal data-dependency rules.
Generated pages are not included in that collection, even after earlier yielded pages have been written.
This keeps factories downstream of source discovery without exposing generation order or creating page-generation cycles.

### Generated page definitions

| Field | Behavior |
|---|---|
| `outputName` | Output path relative to the pages file's directory. It must name a file, must not be absolute or contain `..` segments, and cannot end in a path separator. Defaults to `<pages-file-name>/index.html`. |
| `vars` | Page-level vars merged with the normal default, global, layout, and builder vars. |
| `children` | Optional static child content or inline `PageFunction` rendered before the layout. |
| `draft` | When `true`, the page is omitted unless the CLI uses `--drafts` or a programmatic build uses `buildDrafts: true`. |

Generated pages use [global bundles](../global-bundles/) and [layout assets](../layouts/#layout-styles).
They do not have page-local `style.css`, `client.js`, or worker entries because they do not have their own source-page directory.
Support for [page outputs](../pages/#page-outputs) on generated pages is deferred.
Generated pages skip all `pageOutputs` hooks, including hooks inherited from layouts.

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

For metadata-driven redirects, see the cookbook recipe [Generate redirect pages from page metadata](../cookbook/redirect-pages/).

### Registered layouts for generated pages

For a [registered layout chain](../layouts/#inferring-registered-layout-chains), use `GeneratedPageForLayout<Name, PageVars, PageData, GlobalVars>` for a definition or `PagesForLayout<Name, PageVars, GlobalVars, FactoryData, PageData>` for a factory.
These helpers validate required vars from actual known sources, rather than assuming values exist because a renderer requires them.
`PageVars` describes only what each definition supplies; inline renderers receive the merged globals, layout defaults, and page vars.

For the registered `article` layout in the layout guide, which accepts string content and defaults `showSidebar`, a single definition can be typed as follows:

```ts
import type { GeneratedPageForLayout } from '@domstack/static/types.js'
import type globalVars from './global.vars.ts'

type GlobalVars = Awaited<ReturnType<typeof globalVars>>

type ArticleDefinition = GeneratedPageForLayout<
  'article',
  { title: string },
  Record<string, never>,
  GlobalVars
>

const article: ArticleDefinition = {
  outputName: 'article/index.html',
  vars: { layout: 'article', title: 'Generated article' },
  children: ({ vars }) => vars.showSidebar ? '<p>With sidebar</p>' : '<p>No sidebar</p>',
}

export default article
```

The actual global provider must supply `siteName`, as required by the registered root renderer.
The definition supplies neither `siteName` nor `showSidebar`, but its inline renderer can access both.
Its `vars` property is required and must contain the literal `layout: 'article'`, even when a global default would select the same layout.
A missing title, incompatible override, wrong selector, or incompatible children produces a type error.

Factories keep their own inputs separate from each generated page:

```ts
import type { DataDeps, PagesForLayout } from '@domstack/static/types.js'
import type globalVars from './global.vars.ts'

type GlobalVars = Awaited<ReturnType<typeof globalVars>>
type FactoryData = { articleTitles: string[] }
type InlineData = { announcement: string }
type SuppliedVars = {
  title: string
  dataDeps: DataDeps<InlineData>
}

export const dataDeps = ['articleTitles'] satisfies DataDeps<FactoryData>

const articles: PagesForLayout<
  'article', SuppliedVars, GlobalVars, FactoryData, InlineData
> = async function * ({ vars: globals, data: factoryData }) {
  for (const [index, title] of factoryData.articleTitles.entries()) {
    yield {
      outputName: `articles/${index}/index.html`,
      vars: { layout: 'article', title, dataDeps: ['announcement'] },
      children: ({ vars, data }) => {
        // vars contains siteName, title, and showSidebar, but not dataDeps.
        // data contains announcement, not articleTitles or layout subscriptions.
        return `${globals.siteName}: ${vars.title} — ${data.announcement}`
      },
    }
  }
}

export default articles
```

Here the factory sees only effective global vars and its own subscribed data, not layout defaults or page vars.
The inline page receives its own data contract; `FactoryData` and `PageData` default independently and do not inherit from each other.
The global-data provider must produce both declared data keys; supplying type arguments does not create subscriptions.
Escape interpolated content with your template library when producing HTML from untrusted values.

Factories can return one definition, an array, an async iterable, `null`, or `undefined`, directly or through a promise.
Arrays and iterables contain definitions, not promises or nullish placeholders.
Use a union of individually checked `GeneratedPageForLayout` types for heterogeneous collections; a single `PagesForLayout` checks one literal selected layout.
The existing explicit `GeneratedPageDefinition` and `PagesFunction` APIs remain available for dynamic or unregistered layouts.

Children follow the runtime boundary:

- Static content must match the innermost layout's accepted children type.
- Omitted, `undefined`, or static `null` content becomes an empty string, so these forms are allowed only when that layout accepts `''`.
- Inline renderer results are awaited and then passed through unchanged, including nullish values; a layout accepting only `null` therefore needs `children: () => null`, not static `null`.
- Static callable and thenable objects are not supported by this strict helper; use an inline renderer so invocation and awaiting are explicit.
- Static objects reserve `call`, `apply`, `bind`, and `then` properties to avoid accidentally accepting functions or promises through structural object compatibility.
- To pass a function as a child's render value, wrap it in an inline renderer that returns the function.

See the [basic example's generated guides](../../examples/basic/src/guides.pages.ts) for static and async inline content using the same registered chain.

## Templates

Template files let you write any kind of file type to the `dest` folder while customizing the contents with global vars and explicitly subscribed global data.
Template files can be located anywhere in the `src` directory.
For a complete feed-generation recipe, see [Generate RSS and JSON feeds](../cookbook/feeds/).

Template files look like:

```bash
name-of-template.txt.template.ts
${name-portion}.template.ts
```

Template files are `.ts` files that default-export one of the following sync/async functions:

> [!NOTE]
> Wherever you see `.template.ts` being used, you can also use `.template.js`.
Type checking is supported in both file types.
See [Supported file types](../typescript/#supported-file-types) for all available extensions.

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
Use [`global.data.ts`](../data/#global-data) to turn source-page collections into values a template can subscribe to.

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
