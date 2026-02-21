import type { TemplateAsyncIterator } from '@domstack/static'
import type { SiteVars } from './global.vars.js'
import type { GlobalData, BlogPost } from './global.data.js'

type FeedVars = SiteVars

/**
 * Generates JSON Feed and Atom feeds.
 *
 * blogPosts comes from global.data.ts and is stamped onto every page's vars.
 * Templates receive bare globalVars (pre-globalData) via `vars`, so we read
 * blogPosts from pages[0].vars instead — it's present on every page.
 */
const feedsTemplate: TemplateAsyncIterator<FeedVars> = async function * ({
  vars,
  pages,
}) {
  const { siteName, homePageUrl, siteDescription, authorName, authorUrl } = vars

  // globalDataVars is stamped onto every page — grab blogPosts from the first page
  const blogPosts: BlogPost[] = ((pages[0]?.vars as unknown as GlobalData)?.blogPosts) ?? []

  // Render inner HTML for each post (used in feed content_html)
  const feedItems = await Promise.all(
    blogPosts.slice(0, 20).map(async post => {
      const page = pages.find(p => p.pageInfo.path === post.path)
      return {
        id: `${homePageUrl}/${post.path}/`,
        url: `${homePageUrl}/${post.path}/`,
        title: post.title,
        date_published: new Date(post.publishDate).toISOString(),
        summary: post.description || undefined,
        tags: post.tags.length > 0 ? post.tags : undefined,
        content_html: page ? await page.renderInnerPage({ pages }) : '',
      }
    })
  )

  // JSON Feed 1.1
  const jsonFeed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: siteName,
    home_page_url: homePageUrl,
    feed_url: `${homePageUrl}/feeds/feed.json`,
    description: siteDescription,
    authors: [{ name: authorName, url: authorUrl }],
    items: feedItems,
  }

  yield {
    content: JSON.stringify(jsonFeed, null, 2),
    outputName: 'feeds/feed.json',
  }

  // Minimal Atom feed (hand-rolled — avoids an extra dependency)
  const atomEntries = feedItems.map(item => `
  <entry>
    <id>${item.id}</id>
    <title type="html"><![CDATA[${item.title}]]></title>
    <link href="${item.url}" />
    <published>${item.date_published}</published>
    <updated>${item.date_published}</updated>
    ${item.summary ? `<summary type="html"><![CDATA[${item.summary}]]></summary>` : ''}
    <content type="html"><![CDATA[${item.content_html}]]></content>
  </entry>`).join('\n')

  const atomFeed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${siteName}</title>
  <subtitle>${siteDescription}</subtitle>
  <link href="${homePageUrl}/feeds/feed.xml" rel="self" />
  <link href="${homePageUrl}/" />
  <id>${homePageUrl}/</id>
  <updated>${feedItems[0]?.date_published ?? new Date().toISOString()}</updated>
  <author>
    <name>${authorName}</name>
    <uri>${authorUrl}</uri>
  </author>
${atomEntries}
</feed>`

  yield {
    content: atomFeed,
    outputName: 'feeds/feed.xml',
  }
}

export default feedsTemplate
