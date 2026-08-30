/**
 * @import { GlobalDataFunction } from '#types'
 */

/**
 * @typedef {object} BlogPost
 * @property {string} path
 * @property {string} url
 * @property {string} title
 * @property {string} publishDate
 */

/**
 * @typedef {object} BlogData
 * @property {BlogPost[]} blogPosts
 * @property {number} sourcePageCount
 */

/** @type {GlobalDataFunction<BlogData>} */
export default function globalData ({ pages }) {
  /** @type {BlogPost[]} */
  const blogPosts = []

  for (const page of pages) {
    const publishDateValue = page.vars.publishDate
    if (!page.pageInfo.path.startsWith('blog/') || (typeof publishDateValue !== 'string' && !(publishDateValue instanceof Date))) continue

    const publishDate = new Date(publishDateValue.valueOf())
    if (Number.isNaN(publishDate.valueOf())) continue

    blogPosts.push({
      path: page.pageInfo.path,
      url: page.pageInfo.url,
      title: String(page.vars.title ?? 'Untitled'),
      publishDate: publishDate.toISOString(),
    })
  }

  blogPosts.sort((a, b) => b.publishDate.localeCompare(a.publishDate))

  return {
    blogPosts,
    sourcePageCount: pages.length,
  }
}
