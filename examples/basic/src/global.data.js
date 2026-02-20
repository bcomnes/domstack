/**
 * @import { PageInfo } from '@domstack/static'
 */
import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

/**
 * @param {{ pages: PageInfo[] }} params
 */
export default async function globalData ({ pages }) {
  const blogPosts = pages
    .filter(p => p.vars?.layout === 'blog')
    // @ts-ignore
    .sort((a, b) => new Date(b.vars.publishDate) - new Date(a.vars.publishDate))

  /** @type {string} */
  const recentPostsHtml = render(html`
    <ul class="blog-index-list">
      ${blogPosts.slice(0, 5).map(p => {
        const publishDate = p.vars.publishDate ? new Date(p.vars.publishDate) : null
        return html`
          <li class="blog-entry h-entry">
            <a class="blog-entry-link u-url p-name" href="/${p.pageInfo.path}/">${p.vars.title}</a>
            ${publishDate
              ? html`<time class="blog-entry-date dt-published" datetime="${publishDate.toISOString()}">
                  ${publishDate.toISOString().split('T')[0]}
                </time>`
              : null
            }
          </li>
        `
      })}
    </ul>
  `)

  return {
    blogPosts,
    recentPostsHtml,
  }
}
