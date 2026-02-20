/**
 * @import { TemplateAsyncIterator } from '@domstack/static'
 */
import pMap from 'p-map'
// @ts-ignore
import jsonfeedToAtom from 'jsonfeed-to-atom'

/**
 * @type {TemplateAsyncIterator<{
 *   siteName: string,
 *   siteUrl: string,
 *   siteDescription: string,
 *   authorName: string,
 *   authorUrl: string,
 * }>}
 */
export default async function * feedsTemplate ({
  vars: {
    siteName,
    siteUrl,
    siteDescription,
    authorName,
    authorUrl,
  },
  pages,
}) {
  // Use the PageData instances from `pages` (not vars.blogPosts) since we need renderInnerPage()
  const feedPosts = pages
    .filter(p => p.vars.layout === 'blog')
    // @ts-ignore
    .sort((a, b) => new Date(b.vars.publishDate) - new Date(a.vars.publishDate))
    .slice(0, 20)

  const jsonFeed = {
    version: 'https://jsonfeed.org/version/1',
    title: siteName,
    home_page_url: siteUrl,
    feed_url: `${siteUrl}/feeds/feed.json`,
    description: siteDescription,
    author: {
      name: authorName,
      url: authorUrl,
    },
    items: await pMap(feedPosts, async (post) => {
      return {
        date_published: post.vars['publishDate'],
        title: post.vars['title'],
        url: `${siteUrl}/${post.pageInfo.path}/`,
        id: `${siteUrl}/${post.pageInfo.path}/`,
        content_html: await post.renderInnerPage({ pages }),
      }
    }, { concurrency: 4 }),
  }

  yield {
    content: JSON.stringify(jsonFeed, null, '  '),
    outputName: './feeds/feed.json',
  }

  yield {
    content: jsonfeedToAtom(jsonFeed),
    outputName: './feeds/feed.xml',
  }
}
