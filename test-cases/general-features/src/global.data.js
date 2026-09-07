/**
 * @import { AsyncGlobalDataFunction } from '#types'
 */

import { html, render } from 'fragtml'
import pMap from 'p-map'

/** @type {AsyncGlobalDataFunction<{
 *   blogPostsHtml: string,
 *   blogYears: string[],
 *   feedItems: Array<{ title: string, path: string, publishDate: unknown, contentHtml: string }>,
 *   globalDataSentinel: string
 * }>} */
export default async function ({ pages }) {
  const blogPosts = pages
    .filter(page => page.vars?.layout === 'blog' && page.vars?.publishDate)
    // @ts-ignore
    .sort((a, b) => new Date(b.vars.publishDate) - new Date(a.vars.publishDate))
    .slice(0, 5)

  /** @type {string} */
  const blogPostsHtml = render(html`
    <ul class="blog-index-list">
      ${blogPosts.map(p => {
        const publishDate = p.vars?.publishDate ? new Date(p.vars.publishDate) : null
        return html`
          <li class="blog-entry h-entry">
            <a class="blog-entry-link u-url u-uid p-name" href="/${p.pageInfo.path}/">
              ${p.vars?.title}
            </a>
            ${publishDate
              ? html`
                  <time class="blog-entry-date dt-published" datetime="${publishDate.toISOString()}">
                    ${publishDate.toISOString().split('T')[0]}
                  </time>`
              : null
            }
          </li>
        `
      })}
    </ul>
  `)

  const blogYears = Array.from(new Set(
    blogPosts
      .map(page => page.pageInfo.path.split('/')[1])
      .filter(year => year !== undefined)
  ))
  const feedItems = await pMap(blogPosts, async page => ({
    title: String(page.vars.title),
    path: page.pageInfo.path,
    publishDate: page.vars.publishDate,
    contentHtml: String(await page.renderInnerPage()),
  }), { concurrency: 4 })

  return {
    blogPostsHtml,
    blogYears,
    feedItems,
    globalDataSentinel: 'data-from-global-dot-data',
  }
}
