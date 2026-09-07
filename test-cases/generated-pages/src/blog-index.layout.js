/**
 * @import { LayoutFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */

import { html } from 'fragtml'
import rootLayout from './root.layout.js'

export const vars = {
  dataDeps: ['sourcePageCount'],
}

/**
 * @typedef {object} BlogPost
 * @property {string} path
 * @property {string} url
 * @property {string} title
 * @property {string} publishDate
 */

/**
 * @typedef {object} IndexVars
 * @property {string} title
 * @property {BlogPost[] | undefined} [posts]
 * @property {number} [sourcePageCount]
 */

/** @type {LayoutFunction<IndexVars, string | HtmlResult, string, { sourcePageCount: number }>} */
export default function blogIndexLayout (args) {
  const { vars } = args
  const children = html`
    <h1>${vars.title}</h1>
    <ul class="blog-index-list">
      ${(vars.posts ?? []).map(post => {
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

  return rootLayout({ ...args, children })
}
