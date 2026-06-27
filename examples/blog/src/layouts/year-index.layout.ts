import { html, raw, render } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'
import { dirname } from 'node:path'
import type { LayoutFunction } from '@domstack/static/types.js'
import rootLayout from './root.layout.ts'
import type { RootVars } from './root.layout.ts'
import type { PostVars } from './post.layout.ts'

export type YearIndexVars = RootVars & Pick<PostVars, 'publishDate' | 'description'>

/**
 * Auto-index layout: lists all direct child pages of the current page's
 * folder, sorted newest-first by publishDate. Use on year/section index
 * pages — just set `layout: year-index` in frontmatter, no page.ts needed.
 */
const yearIndexLayout: LayoutFunction<YearIndexVars, string | HtmlResult, string> = (args) => {
  const { children, page, pages, ...rest } = args
  type DatedPage = (typeof pages)[number] & { vars: YearIndexVars & { publishDate: string } }

  const childPages = pages
    .filter((p): p is DatedPage => dirname(p.pageInfo.path) === page.path && typeof p.vars.publishDate === 'string')
    .sort((a, b) => new Date(b.vars.publishDate).getTime() - new Date(a.vars.publishDate).getTime())

  const wrappedChildren = render(html`
    <div>
      <h1>${args.vars.title}</h1>
      <ul class="post-list">
        ${childPages.map(p => {
          const title = p.vars.title ?? 'Untitled'
          const date = new Date(p.vars.publishDate)
          return html`
            <li class="post-list-item">
              <h2 class="post-list-title">
                <a href="/${p.pageInfo.path}/">${title}</a>
              </h2>
              <p class="post-list-meta">
                <time datetime="${date.toISOString()}">
                  ${date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </time>
              </p>
              ${p.vars.description ? html`<p class="post-list-description">${p.vars.description}</p>` : null}
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

  return rootLayout({ ...rest, page, pages, children: wrappedChildren })
}

export default yearIndexLayout
