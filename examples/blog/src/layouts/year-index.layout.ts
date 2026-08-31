import { html, raw, render } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'
import type { LayoutFunction } from '@domstack/static/types.js'
import rootLayout from './root.layout.ts'
import type { RootVars } from './root.layout.ts'
import type { BlogPost } from '../global.data.ts'

export type YearIndexVars = RootVars & {
  posts?: BlogPost[]
}

/**
 * Yearly archive layout. `global.data.ts` prepares each newest-first post
 * collection and `blog-indexes.pages.ts` assigns it to a generated page.
 */
const yearIndexLayout: LayoutFunction<YearIndexVars, string | HtmlResult, string> = (args) => {
  const { children, ...rest } = args

  const wrappedChildren = render(html`
    <div>
      <h1>${args.vars.title}</h1>
      <ul class="post-list">
        ${(args.vars.posts ?? []).map(post => {
          const date = new Date(post.publishDate)
          return html`
            <li class="post-list-item">
              <h2 class="post-list-title">
                <a href="/${post.path}/">${post.title}</a>
              </h2>
              <p class="post-list-meta">
                <time datetime="${date.toISOString()}">
                  ${date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </time>
              </p>
              ${post.description ? html`<p class="post-list-description">${post.description}</p>` : null}
            </li>
          `
        })}
      </ul>
      ${typeof children === 'string' && children.trim()
        ? html`<div>${raw(children)}</div>`
        : null
      }
    </div>
  `)

  return rootLayout({ ...rest, children: wrappedChildren })
}

export default yearIndexLayout
