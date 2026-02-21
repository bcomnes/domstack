import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'
import { dirname } from 'node:path'
import type { LayoutFunction } from '@domstack/static'

import blogIndexLayout from './blog-index.layout.ts'
import type { BlogIndexVars } from './blog-index.layout.ts'

/**
 * A layout that automatically lists all direct child pages of the current
 * page's folder, sorted by publishDate. Use it on year/section index pages
 * so the page file just sets `layout: 'blog-auto-index'` and returns ''.
 */
const blogAutoIndexLayout: LayoutFunction<BlogIndexVars> = (args) => {
  const { children, ...rest } = args

  const folderPages = args.pages
    .filter(p => dirname(p.pageInfo.path) === args.page.path)
    .sort((a, b) => new Date(b.vars.publishDate).getTime() - new Date(a.vars.publishDate).getTime())

  const wrappedChildren = render(html`
    <ul class="blog-index-list">
      ${folderPages.map(p => {
        const publishDate = new Date(p.vars.publishDate)
        return html`
          <li class="blog-entry h-entry">
            <a class="blog-entry-link u-url p-name" href="/${p.pageInfo.path}/">${p.vars.title}</a>
            <time class="blog-entry-date dt-published" datetime="${publishDate.toISOString()}">
              ${publishDate.toISOString().split('T')[0]}
            </time>
          </li>
        `
      })}
    </ul>
    ${typeof children === 'string'
      ? html`<div dangerouslySetInnerHTML=${{ __html: children }}></div>`
      : children
    }
  `)

  return blogIndexLayout({ children: wrappedChildren, ...rest })
}

export default blogAutoIndexLayout
