import type { LayoutFunction } from '@domstack/static/types.js'
import { html, raw, render } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'

import defaultRootLayout from './root.layout.ts'
import type { PageVars } from './root.layout.ts'

const articleLayout: LayoutFunction<PageVars, string | HtmlResult, string> = (args) => {
  const { children, ...rest } = args
  const wrappedChildren = render(html`
    <article class="bc-article h-entry" itemscope itemtype="http://schema.org/NewsArticle">

      <h1>${rest.vars.title}</h1>

      <section class="e-content" itemprop="articleBody">
        ${typeof children === 'string'
          ? html`<div>${raw(children)}</div>`
          : children
        }
      </section>
    </article>
  `)

  return defaultRootLayout({ children: wrappedChildren, ...rest })
}

export default articleLayout
