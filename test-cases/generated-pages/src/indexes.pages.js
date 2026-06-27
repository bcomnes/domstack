/**
 * @import { PageFunction, PagesFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */

import { html } from 'fragtml'

/** @type {PageFunction<{ title: string, postCount: number }, HtmlResult>} */
const renderIndexPage = ({ vars }) => html`
  <h1>${vars.title}</h1>
  <p id="post-count">${vars.postCount}</p>
`

/** @type {PagesFunction} */
export default function indexesPages ({ pages }) {
  const posts = pages.filter(page => page.vars.publishDate && page.pageInfo.path.startsWith('blog/'))

  return {
    outputName: 'blog/2024/index.html',
    vars: {
      layout: 'root',
      title: '2024 posts',
      postCount: posts.length,
    },
    children: renderIndexPage,
  }
}
