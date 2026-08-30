/**
 * @import { PageData, PageFunction, PagesFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */

import { html } from 'fragtml'

/**
 * @typedef {object} BlogPostVars
 * @property {string} title
 * @property {string | Date} publishDate
 */

/**
 * @typedef {object} IndexVars
 * @property {string} layout
 * @property {string} title
 * @property {PageData<BlogPostVars>[]} posts
 */

/**
 * @typedef {object} SiteVars
 * @property {string} siteName
 */

/**
 * @param {string | Date} value
 * @returns {Date}
 */
function parsePublishDate (value) {
  return new Date(value.valueOf())
}

/** @type {PageFunction<IndexVars, HtmlResult>} */
const renderIndexPage = ({ vars }) => html`
  <h1>${vars.title}</h1>
  <ul class="blog-index-list">
    ${vars.posts.map(post => {
      const isoDate = parsePublishDate(post.vars.publishDate).toISOString()

      return html`
        <li class="blog-entry">
          <a class="blog-entry-link" href="${post.pageInfo.url}">${post.vars.title}</a>
          <time class="blog-entry-date" datetime="${isoDate}">${isoDate.slice(0, 10)}</time>
        </li>
      `
    })}
  </ul>
`

/** @type {PagesFunction<IndexVars, HtmlResult, SiteVars>} */
export default function indexesPages ({ pages, vars }) {
  const posts = /** @type {PageData<BlogPostVars>[]} */ (pages.filter(page => (
    page.pageInfo.path.startsWith('blog/') &&
    typeof page.vars.title === 'string' &&
    (typeof page.vars.publishDate === 'string' || page.vars.publishDate instanceof Date)
  )))
  /** @type {Map<string, PageData<BlogPostVars>[]>} */
  const postsByYear = new Map()

  for (const post of posts) {
    const publishDate = parsePublishDate(post.vars.publishDate)
    if (Number.isNaN(publishDate.valueOf())) continue

    const year = String(publishDate.getUTCFullYear())
    const yearPosts = postsByYear.get(year) ?? []
    yearPosts.push(post)
    postsByYear.set(year, yearPosts)
  }

  return Array.from(postsByYear.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, yearPosts]) => ({
      outputName: `blog/${year}/index.html`,
      vars: {
        layout: 'root',
        title: `${vars.siteName}: ${year} posts`,
        posts: yearPosts.sort((a, b) => parsePublishDate(b.vars.publishDate).valueOf() - parsePublishDate(a.vars.publishDate).valueOf()),
      },
      children: renderIndexPage,
    }))
}
