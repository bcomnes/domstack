---
layout: docs
docsOrder: 132
docsParent: /docs/cookbook/
handlebars: false
---

# Generate RSS and JSON feeds

[All recipes](../)

Use `global.data.ts` to inspect and render source pages, then let a feed template subscribe to the prepared records.

The following example generates an [RSS](https://www.rssboard.org) and [JSON Feed](https://www.jsonfeed.org) from the 10 most recent date-sorted pages using the `blog` layout and the AsyncIterator template type.
It uses [`renderInnerPage()`](../../data/#rendering-page-content) while global data is computed, so the template never receives the page graph.
See the [blog example's `global.data.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/global.data.ts) and [`feeds.template.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/feeds.template.ts) for a working implementation.

```typescript
// src/global.data.ts
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
  const posts: typeof pages = []
  for (const page of pages) {
    if (page.pageInfo.path.startsWith('blog/') && page.vars.layout === 'blog') {
      posts.push(page)
    }
  }

  posts.sort((a, b) => new Date(b.vars.publishDate).valueOf() - new Date(a.vars.publishDate).valueOf())

  const feedItems: FeedItem[] = []
  for (const page of posts.slice(0, 10)) {
    feedItems.push({
      datePublished: String(page.vars.publishDate),
      title: String(page.vars.title),
      urlPath: page.pageInfo.url,
      contentHtml: String(await page.renderInnerPage()),
    })
  }

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
    authorName,
    authorUrl,
    authorImgUrl,
  },
  data,
}) {
  const items = []
  for (const item of data.feedItems) {
    items.push({
      date_published: item.datePublished,
      title: item.title,
      url: `${homePageUrl}${item.urlPath}`,
      id: `${homePageUrl}${item.urlPath}#${item.datePublished}`,
      content_html: item.contentHtml,
    })
  }

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
    items,
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
