/**
 * @import { AsyncPageFunction } from '#types'
 */
import { html } from 'fragtml'

/**
 * @type {AsyncPageFunction<{}, string, { blogYears: string[] }>}
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

  // @ts-ignore
  return children
}

export const vars = {
  somePageScopled: 'vars',
  dataDeps: ['blogYears'],
}
