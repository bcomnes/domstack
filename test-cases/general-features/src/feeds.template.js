/**
 * @import { TemplateAsyncIterator } from '#types'
 */
// @ts-ignore
import jsonfeedToAtom from 'jsonfeed-to-atom'

/**
 * @typedef FeedTemplateVars
 * @property {string} title
 * @property {string} layout
 * @property {string} siteName
 * @property {string} homePageUrl
 * @property {string} authorName
 * @property {string} authorUrl
 * @property {string} authorImgUrl
 * @property {string} publishDate
 * @property {string} siteDescription
 */

export const dataDependencies = ['feedItems', 'globalDataSentinel']

/** @type {TemplateAsyncIterator<FeedTemplateVars, {
 *   feedItems: Array<{ title: string, path: string, publishDate: string, contentHtml: string }>,
 *   globalDataSentinel: string
 * }>} */
export default async function * feedsTemplate ({
  vars: {
    siteName,
    homePageUrl,
    authorName,
    authorUrl,
    authorImgUrl,
    siteDescription,
  },
  data,
}) {
  const jsonFeed = {
    version: 'https://jsonfeed.org/version/1',
    title: siteName,
    home_page_url: homePageUrl,
    feed_url: `${homePageUrl}/feed.json`,
    description: siteDescription,
    _globalDataSentinel: data.globalDataSentinel,
    author: {
      name: authorName,
      url: authorUrl,
      avatar: authorImgUrl,
    },
    items: data.feedItems.map(item => {
      return {
        date_published: item.publishDate,
        title: item.title,
        url: `${homePageUrl}/${item.path}/`,
        id: `${homePageUrl}/${item.path}/#${item.publishDate}`,
        content_html: item.contentHtml,
      }
    }),
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
