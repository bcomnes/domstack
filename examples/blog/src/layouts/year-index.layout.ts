import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'
import { dirname } from 'node:path'
import type { LayoutFunction } from '@domstack/static'
import rootLayout from './root.layout.ts'
import type { RootVars } from './root.layout.ts'

export type YearIndexVars = RootVars

/**
 * Auto-index layout: lists all direct child pages of the current page's
 * folder, sorted newest-first by publishDate. Use on year/section index
 * pages — just set `layout: year-index` in frontmatter, no page.ts needed.
 */
const yearIndexLayout: LayoutFunction<YearIndexVars> = (args) => {
  const { children, page, pages, ...rest } = args

  const childPages = pages
    .filter(p => dirname(p.pageInfo.path) === page.path && p.vars.publishDate)
    .sort((a, b) => new Date(b.vars.publishDate).getTime() - new Date(a.vars.publishDate).getTime())

  const wrappedChildren = render(html`
    <div>
      <h1>${args.vars.title}</h1>
      <ul class="post-list">
        ${childPages.map(p => {
          const date = new Date(p.vars.publishDate)
          return html`
            <li class="post-list-item">
              <h2 class="post-list-title">
                <a href="/${p.pageInfo.path}/">${p.vars.title}</a>
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
        ? html`<div dangerouslySetInnerHTML=${{ __html: children }} />`
        : null
      }
    </div>
  `)

  return rootLayout({ ...rest, page, pages, children: wrappedChildren })
}

export default yearIndexLayout
