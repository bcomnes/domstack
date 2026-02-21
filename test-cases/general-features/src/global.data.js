/**
 * @import { PageData } from '../../../index.js'
 */
import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

/**
 * @param {{ pages: PageData[] }} params
 */
export default async function globalData ({ pages }) {
  const blogPosts = pages
    .filter(page => page.vars?.layout === 'blog' && page.vars?.publishDate)
    .sort((a, b) => new Date(b.vars.publishDate).getTime() - new Date(a.vars.publishDate).getTime())
    .slice(0, 5)

  /** @type {string} */
  const blogPostsHtml = render(html`
    <ul className="blog-index-list">
      ${blogPosts.map(p => {
        const publishDate = p.vars.publishDate ? new Date(p.vars.publishDate) : null
        return html`
          <li className="blog-entry h-entry">
            <a className="blog-entry-link u-url u-uid p-name" href="/${p.pageInfo.path}/">
              ${p.vars.title}
            </a>
            ${publishDate
              ? html`
                  <time className="blog-entry-date dt-published" datetime="${publishDate.toISOString()}">
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
    blogPostsHtml
  }
}
