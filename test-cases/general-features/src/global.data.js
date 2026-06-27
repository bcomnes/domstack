/**
 * @import { AsyncGlobalDataFunction } from '#types'
 */

import { html, render } from 'fragtml'

/** @type {AsyncGlobalDataFunction<{ blogPostsHtml: string, globalDataSentinel: string }>} */
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

  return { blogPostsHtml, globalDataSentinel: 'data-from-global-dot-data' }
}
