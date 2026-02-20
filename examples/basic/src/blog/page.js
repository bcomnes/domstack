/**
 * @import { PageFunction, PageData } from '@domstack/static'
 */
import { html } from 'htm/preact'
import { dirname, basename } from 'node:path'

export const vars = {
  title: 'Blog',
  layout: 'blog-index',
}

/**
 * All blog posts come from vars.blogPosts, which is computed once in
 * global.data.js and made available to every page.
 *
 * Year archive links are derived from direct child folder pages.
 *
 * @type {PageFunction<{
 *   blogPosts: PageData[],
 *   title: string,
 *   publishDate?: string,
 * }>}
 */
export default async function blogIndex ({ vars, pages, page }) {
  const { blogPosts } = vars

  const yearPages = pages
    .filter(p => dirname(p.pageInfo.path) === page.path)
    .sort((a, b) => basename(b.pageInfo.path).localeCompare(basename(a.pageInfo.path)))

  return html`
    <ul class="blog-index-list">
      ${blogPosts.map(p => {
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
    <footer class="blog-index-footer">
      <h2>Archive</h2>
      <ul class="archive-list">
        ${yearPages.map(p => html`
          <li><a href="/${p.pageInfo.path}/">${basename(p.pageInfo.path)}</a></li>
        `)}
      </ul>
      <p><a href="/feeds/feed.json">JSON Feed</a> · <a href="/feeds/feed.xml">Atom Feed</a></p>
    </footer>
  `
}
