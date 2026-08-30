/**
 * @import { PageFunction, PagesFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */

import { html } from 'fragtml'

/**
 * @typedef {object} BlogPost
 * @property {string} path
 * @property {string} url
 * @property {string} title
 * @property {string} publishDate
 */

/**
 * @typedef {object} IndexVars
 * @property {string} layout
 * @property {string} title
 * @property {BlogPost[]} posts
 */

/**
 * @typedef {object} CollectionVars
 * @property {string} siteName
 * @property {BlogPost[]} blogPosts
 */

/** @type {PageFunction<IndexVars, HtmlResult>} */
const renderIndexPage = ({ vars }) => html`
  <h1>${vars.title}</h1>
  <ul class="blog-index-list">
    ${vars.posts.map(post => {
      const publishDate = new Date(post.publishDate)

      return html`
        <li class="blog-entry">
          <a class="blog-entry-link" href="${post.url}">${post.title}</a>
          <time class="blog-entry-date" datetime="${post.publishDate}">${publishDate.toISOString().slice(0, 10)}</time>
        </li>
      `
    })}
  </ul>
`

/** @type {PagesFunction<IndexVars, HtmlResult, CollectionVars>} */
export default function indexesPages ({ vars }) {
  /** @type {Map<string, BlogPost[]>} */
  const postsByYear = new Map()

  for (const post of vars.blogPosts) {
    const year = String(new Date(post.publishDate).getUTCFullYear())
    const yearPosts = postsByYear.get(year) ?? []
    yearPosts.push(post)
    postsByYear.set(year, yearPosts)
  }

  const indexes = []
  for (const [year, posts] of postsByYear) {
    posts.sort((a, b) => b.publishDate.localeCompare(a.publishDate))
    indexes.push({
      outputName: `blog/${year}/index.html`,
      vars: {
        layout: 'root',
        title: `${vars.siteName}: ${year} posts`,
        posts,
      },
      children: renderIndexPage,
    })
  }

  indexes.sort((a, b) => b.outputName.localeCompare(a.outputName))
  return indexes
}
