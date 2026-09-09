---
layout: docs
handlebars: false
---

<a id="cookbook"></a>

# Recipes

These recipes combine DOMStack features to solve common site-building tasks.
Use them as starting points for nested layouts, feeds, archive pages, and redirects.

## Table of Contents

[[toc]]

## Compose nested layouts

This recipe uses the [explicit `parentLayout` declaration](../../docs/pages/#declaring-nested-layouts) described in the layout API.
Pages select their innermost layout with `vars.layout`.
A layout can export a static `parentLayout` name to let DOMStack wrap it in another layout.

```typescript
// article.layout.ts
import { html, raw, render } from 'fragtml'
import type { LayoutFunction } from '@domstack/static/types.js'
import type { RootLayoutVars } from './root.layout.ts'

export const parentLayout = 'root'
export const vars = { showSidebar: true }

const articleLayout: LayoutFunction<RootLayoutVars, string, string> = ({ children }) => {
  return render(html`<article>${raw(children)}</article>`)
}

export default articleLayout
```

```typescript
// posts/example/page.ts
export const vars = { layout: 'article', title: 'A post' }
export default () => '<p>Hello from the post.</p>'
```

DOMStack renders `root(article(page()))`.
A root layout omits `parentLayout`; child layouts can name any discovered layout, including the bundled `root`.
Names are the same filename-derived names used by `vars.layout`, not import paths.
Missing parents, invalid parent exports, and cycles fail the build with the offending layout or chain.

All renderers receive the same resolved vars, page metadata, worker URLs, and asset lists.
Vars merge from outermost to innermost layout, followed by page vars and builder/frontmatter vars.
Layout `vars.layout` does not select a parent; only the named `parentLayout` export establishes nesting.
Async layouts are awaited at every step, and intermediate values pass through unchanged until the final result is serialized.
Each parent must accept the kind of children its immediate child returns.

### Data subscriptions in nested layouts

Each layout declares only the data it reads.
Keep focused consumer types beside their producer in `global.data.ts`:

```typescript
// global.data.ts
export type RootLayoutData = { navigation: { title: string, url: string }[] }
export type ArticleLayoutData = { recentPosts: { title: string, url: string }[] }
export type GlobalData = RootLayoutData & ArticleLayoutData
```

```typescript
// root.layout.ts
import type { DataDeps } from '@domstack/static/types.js'
import type { RootLayoutData } from './global.data.ts'

export const vars = {
  dataDeps: ['navigation'] satisfies DataDeps<RootLayoutData>,
}
```

```typescript
// article.layout.ts
import type { DataDeps } from '@domstack/static/types.js'
import type { ArticleLayoutData } from './global.data.ts'

export const parentLayout = 'root'
export const vars = {
  dataDeps: ['recentPosts'] satisfies DataDeps<ArticleLayoutData>,
}
```

These declaration snippets accompany each layout's render function.
The root receives `data.navigation`, and the article receives `data.recentPosts`.
A page using `article` rebuilds when either key changes, but it receives neither key unless it declares its own subscription.
Only put a subscription in a shared root when every descendant genuinely uses that data through the root.

### Nested layout client bundles and styles

DOMStack includes each ancestor's own style and client entry automatically.
The order is defaults → globals → outer layouts → inner layouts → page assets.
For example, a post using `article` receives `root.layout.css` before `article.layout.css`.
Do not also import the parent's layout CSS or client from the child: doing both duplicates its contents or execution.

Watch mode uses the resolved chain for source-backed and generated pages.
Changing a parent layout or one of its imported helpers rebuilds descendant pages, and changing the chain updates those relationships after a successful build.
Existing asset edits use esbuild's watcher; adding or removing a layout asset updates the affected pages' asset lists.

### Manual composition

Manual function composition is supported and tested for source-backed and generated pages.
Prefer `parentLayout` for ordinary nesting: DOMStack can then manage the full chain's defaults, assets, dependencies, and rebuilds for you.
A layout without `parentLayout` still runs once, and it may import and call other render functions itself.
DOMStack does not infer a parent from those imports, merge the imported function's vars, or add its assets.
Manual composition must forward the required arguments and explicitly import parent assets.
The composing layout also declares every data key its manually called helpers need and forwards `data` itself.

```typescript
// manual.layout.ts
import rootLayout from './root.layout.ts'
import type { DataDeps, LayoutFunction } from '@domstack/static/types.js'
import type { RootLayoutVars } from './root.layout.ts'
import type { RootLayoutData } from './global.data.ts'

export const vars = { dataDeps: ['navigation'] satisfies DataDeps<RootLayoutData> }

const manualLayout: LayoutFunction<RootLayoutVars, string, string, RootLayoutData> = args => {
  return rootLayout({ ...args, children: `<article>${args.children}</article>` })
}

export default manualLayout
```

Static import tracking still rebuilds these pages when an imported parent or helper changes.
The composing layout's declared keys also trigger rebuilds when their global-data values change, for both source-backed and generated pages.
If the parent has layout CSS or client code, import those files from the composing layout's corresponding asset entries.
These manual responsibilities are why explicit `parentLayout` nesting is recommended, not a restriction on using ordinary functions.

To migrate, replace the parent function call with a `parentLayout` export and return only the child wrapper.
Move shared defaults into exported layout `vars`, and remove child imports of the parent's layout CSS and client.
Do not keep the manual parent call when adding `parentLayout`, or the parent will render twice.

## Generate RSS and JSON feeds

Use `global.data.ts` to inspect and render source pages, then let a feed template subscribe to the prepared records.

The following example generates an [RSS](https://www.rssboard.org) and [JSON Feed](https://www.jsonfeed.org) from the 10 most recent date-sorted pages using the `blog` layout and the AsyncIterator template type.
It uses [`renderInnerPage()`](../../docs/content/#rendering-page-content) while global data is computed, so the template never receives the page graph.
See the [blog example's `global.data.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/global.data.ts) and [`feeds.template.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/feeds.template.ts) for a working implementation.

```typescript
// src/global.data.ts
import pMap from 'p-map'
import type { AsyncGlobalDataFunction } from '@domstack/static/types.js'

export interface FeedItem {
  datePublished: string
  title: string
  urlPath: string
  contentHtml: string
}

export interface GlobalData {
  feedItems: FeedItem[]
}

export type FeedsTemplateData = Pick<GlobalData, 'feedItems'>

const globalData: AsyncGlobalDataFunction<GlobalData> = async ({ pages }) => {
  const posts = pages
    .filter(page => page.pageInfo.path.startsWith('blog/') && page.vars.layout === 'blog')
    .sort((a, b) => new Date(b.vars.publishDate).valueOf() - new Date(a.vars.publishDate).valueOf())
    .slice(0, 10)

  const feedItems = await pMap(posts, async page => ({
    datePublished: String(page.vars.publishDate),
    title: String(page.vars.title),
    urlPath: page.pageInfo.url,
    contentHtml: String(await page.renderInnerPage()),
  }), { concurrency: 4 })

  return { feedItems }
}

export default globalData
```

```typescript
// src/feeds.template.ts
import jsonfeedToAtom from 'jsonfeed-to-atom'
import type { DataDeps, TemplateAsyncIterator } from '@domstack/static/types.js'
import type { FeedsTemplateData } from './global.data.js'

interface TemplateVars {
  title: string;
  layout: string;
  siteName: string;
  homePageUrl: string;
  authorName: string;
  authorUrl: string;
  authorImgUrl?: string;
  siteDescription: string;
  language: string;
}

export const dataDeps = ['feedItems'] satisfies DataDeps<FeedsTemplateData>

const feedsTemplate: TemplateAsyncIterator<TemplateVars, FeedsTemplateData> = async function * ({
  vars: {
    siteName,
    siteDescription,
    homePageUrl,
    language = 'en-us',
    authorName,
    authorUrl,
    authorImgUrl,
  },
  data,
}) {
  const jsonFeed = {
    version: 'https://jsonfeed.org/version/1',
    title: siteName,
    home_page_url: homePageUrl,
    feed_url: `${homePageUrl}/feed.json`,
    description: siteDescription,
    author: {
      name: authorName,
      url: authorUrl,
      avatar: authorImgUrl
    },
    items: data.feedItems.map(item => {
      return {
        date_published: item.datePublished,
        title: item.title,
        url: `${homePageUrl}${item.urlPath}`,
        id: `${homePageUrl}${item.urlPath}#${item.datePublished}`,
        content_html: item.contentHtml,
      }
    }),
  }

  yield {
    content: JSON.stringify(jsonFeed, null, '  '),
    outputName: './feeds/feed.json'
  }

  yield {
    content: jsonfeedToAtom(jsonFeed),
    outputName: './feeds/feed.xml'
  }
}

export default feedsTemplate
```

## Generate yearly blog index pages

Global data centralizes collection and grouping once, then generated pages turn those records into pages.
See the working [blog example directory](https://github.com/bcomnes/domstack/tree/master/examples/blog/), [`global.data.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/global.data.ts), [`blog-indexes.pages.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/blog-indexes.pages.ts), and [`year-index.layout.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/layouts/year-index.layout.ts).

First, collect source-backed pages whose layout is `post`, validate and normalize their publish dates, sort them newest-first, and group them into yearly `blogIndexes`:

```typescript
// src/global.data.ts
import type {
  AsyncGlobalDataFunction,
  GlobalDataFunctionParams,
} from '@domstack/static/types.js'

export interface BlogPost {
  path: string
  title: string
  publishDate: string
}

export interface BlogIndex {
  year: number
  posts: BlogPost[]
}

export interface GlobalData {
  blogIndexes: BlogIndex[]
}

export type BlogIndexesPagesData = Pick<GlobalData, 'blogIndexes'>

type SourcePageVars = { layout?: string, title?: unknown, publishDate?: unknown }

function collectBlogPosts (pages: GlobalDataFunctionParams<SourcePageVars>['pages']): BlogPost[] {
  return pages
    .filter(page => page.vars.layout === 'post')
    .map(page => {
      const value = page.vars.publishDate
      if (typeof value !== 'string' && !(value instanceof Date)) {
        throw new TypeError(`Post "${page.pageInfo.path}" needs a publishDate`)
      }

      const publishDate = new Date(value.valueOf())
      if (Number.isNaN(publishDate.valueOf())) {
        throw new TypeError(`Post "${page.pageInfo.path}" has an invalid publishDate`)
      }

      return {
        path: page.pageInfo.path,
        title: String(page.vars.title ?? 'Untitled'),
        publishDate: publishDate.toISOString(),
      }
    })
    .sort((a, b) => b.publishDate.localeCompare(a.publishDate))
}

const globalData: AsyncGlobalDataFunction<GlobalData, SourcePageVars> = async ({ pages }) => {
  const postsByYear = new Map<number, BlogPost[]>()

  for (const post of collectBlogPosts(pages)) {
    const year = new Date(post.publishDate).getUTCFullYear()
    postsByYear.set(year, [...(postsByYear.get(year) ?? []), post])
  }

  const blogIndexes = [...postsByYear]
    .map(([year, posts]) => ({ year, posts }))
    .sort((a, b) => b.year - a.year)

  return { blogIndexes }
}

export default globalData
```

Then subscribe to `blogIndexes` and create one `blog/<year>/index.html` page per group using the `year-index` layout:

```typescript
// src/blog-indexes.pages.ts
import type { DataDeps, PagesFunction } from '@domstack/static/types.js'
import type { BlogIndexesPagesData, BlogPost } from './global.data.js'

type YearIndexPageVars = {
  layout: 'year-index'
  title: string
  posts: BlogPost[]
}

export const dataDeps = ['blogIndexes'] satisfies DataDeps<BlogIndexesPagesData>

const blogIndexes: PagesFunction<
  YearIndexPageVars,
  string,
  Record<string, never>,
  BlogIndexesPagesData
> = ({ data }) =>
  data.blogIndexes.map(({ year, posts }) => ({
    outputName: `blog/${year}/index.html`,
    vars: {
      layout: 'year-index',
      title: String(year),
      posts,
    },
  }))

export default blogIndexes
```

## Generate redirect pages from page metadata

See the working [blog example directory](https://github.com/bcomnes/domstack/tree/master/examples/blog/), [`redirects.pages.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/redirects.pages.ts), and [`redirect.layout.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/layouts/redirect.layout.ts).

Sites migrating from another platform often need redirect pages for old URLs that no longer exist.
Keep that history on the current page with `redirectFrom` metadata instead of maintaining a separate old/new mapping:

```md
---
title: Current Post
redirectFrom:
  - /2020/old-slug/
  - /blog/original-title/
---
<!-- src/blog/current-post.md -->

# Current Post
```

Collect the metadata in `global.data.ts`.
The current page's URL becomes the redirect target automatically:

```typescript
// src/global.data.ts
function collectRedirects (pages) {
  const redirects = []
  const redirectOwners = new Map()

  for (const page of pages) {
    const redirectFrom = page.vars.redirectFrom
    if (redirectFrom === undefined) continue

    const source = page.pageInfo.pageFile.relname
    if (!Array.isArray(redirectFrom)) throw new TypeError(`redirectFrom on "${source}" must be an array`)

    for (const from of redirectFrom) {
      if (typeof from !== 'string') throw new TypeError(`redirectFrom entries on "${source}" must be strings`)
      if (from.trim() !== from || !from.startsWith('/') || from.startsWith('//')) throw new Error(`Invalid redirectFrom "${from}" on "${source}": expected a same-origin URL path`)
      if (from.includes('?') || from.includes('#') || from.includes('\\') || from.split('/').some(part => part === '.' || part === '..')) throw new Error(`Invalid redirectFrom "${from}" on "${source}": unsupported URL path`)

      const existingSource = redirectOwners.get(from)
      if (existingSource) throw new Error(`redirectFrom "${from}" is declared by both "${existingSource}" and "${source}"`)

      redirectOwners.set(from, source)
      redirects.push({ from, to: page.pageInfo.url })
    }
  }

  return redirects
}

export default function globalData ({ pages }) {
  return { redirects: collectRedirects(pages) }
}
```

Validation happens while the destination page is still known, so malformed or duplicate metadata reports the page that declared it.
The pages factory then consumes the validated collection and renders each old location through a reusable redirect layout:

```typescript
// src/redirects.pages.ts
function redirectOutputName (from) {
  if (!from.startsWith('/') || from.startsWith('//')) throw new Error(`redirectFrom must be a same-origin URL path: ${from}`)
  if (from.includes('?') || from.includes('#')) throw new Error(`redirectFrom must not include a query or fragment: ${from}`)

  const relativePath = from.slice(1)
  if (relativePath.length === 0) return 'index.html'
  return relativePath.endsWith('/') ? `${relativePath}index.html` : relativePath
}

export const dataDeps = ['redirects']

export default function redirectsPages ({ data }) {
  const pages = []

  for (const { from, to } of data.redirects) {
    pages.push({
      outputName: redirectOutputName(from),
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

```typescript
// src/redirect.layout.ts

import { html, render } from 'fragtml'

export default function redirectLayout ({ vars }) {
  return render(html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${vars.redirectTo}" />
  <link rel="canonical" href="${vars.redirectTo}" />
  <title>${vars.title}</title>
</head>
<body>
  <p>Redirecting to <a href="${vars.redirectTo}">${vars.redirectTo}</a></p>
</body>
</html>`)
}
```

`redirectFrom` contains old same-origin public URL paths.
`redirectOutputName()` converts directory URLs such as `/2020/old-slug/` to `2020/old-slug/index.html`.
DOMStack's generated-output validation still rejects escaping paths such as `..`.
The redirect target comes from the current page's normalized `pageInfo.url`, so moving the page again only requires retaining its previous URLs in that page's metadata.
`fragtml` escapes interpolated values by default, including attribute values and link text.

**SEO note:** Meta-refresh is a client-side redirect.
Search engines may not treat it as a permanent 301 redirect.
For static hosting platforms that support server-side redirects, you can instead generate a `_redirects` file (Netlify, Cloudflare Pages) or `vercel.json` (Vercel) using the object template type:

```typescript
// src/redirects-netlify.txt.template.ts
// Generates a _redirects file for Netlify / Cloudflare Pages.

export const dataDeps = ['redirects']

export default function ({ data }) {
  return {
    outputName: '_redirects',
    content: data.redirects.map(({ from, to }) => `${from}  ${to}  301`).join('\n'),
  }
}
```

Both approaches can coexist and consume the same `global.data.ts` redirect collection.
Copying a directory that contains a hand-crafted `_redirects` file via `--copy` is also an option when you prefer to manage redirects outside the build.

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
