---
layout: docs
docsOrder: 133
docsParent: /docs/cookbook/
handlebars: false
---

# Generate yearly blog index pages

[All recipes](../)

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
