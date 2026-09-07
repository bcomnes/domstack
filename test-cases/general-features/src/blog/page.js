/**
 * @import { AsyncPageFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */
import { html } from 'fragtml'

/**
 * @type {AsyncPageFunction<{}, HtmlResult, { blogYears: string[] }>}
 */
export default async function blogIndex ({
  data
}) {
  const children = html`
    <div>
      <ul>
        ${data.blogYears.map(year => html`
          <li>
            <a href="${`/blog/${year}/`}">
              ${year}
            </a>
          </li>
        `)}
      </ul>
    </div>
  `

  return children
}

export const vars = {
  somePageScopled: 'vars',
  dataDeps: ['blogYears'],
}
