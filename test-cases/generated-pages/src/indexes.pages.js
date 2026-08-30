/**
 * @import { PageFunction, PagesFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */

import { html } from 'fragtml'

/**
 * @typedef {object} IndexVars
 * @property {string} layout
 * @property {string} title
 * @property {number} postCount
 */

/**
 * @typedef {object} SiteVars
 * @property {string} siteName
 */

/** @type {PageFunction<IndexVars, HtmlResult>} */
const renderIndexPage = ({ vars }) => html`
  <h1>${vars.title}</h1>
  <p id="post-count">${vars.postCount}</p>
`

/** @type {PagesFunction<IndexVars, HtmlResult, SiteVars>} */
export default function indexesPages ({ pages, vars }) {
  const posts = pages.filter(page => page.vars.publishDate && page.pageInfo.path.startsWith('blog/'))

  return {
    outputName: 'blog/2024/index.html',
    vars: {
      layout: 'root',
      title: `${vars.siteName}: 2024 posts`,
      postCount: posts.length,
    },
    children: renderIndexPage,
  }
}
