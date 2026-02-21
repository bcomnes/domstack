import type { LayoutFunction } from '@domstack/static'
import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

import defaultRootLayout from './root.layout.ts'
import type { PageVars } from './root.layout.ts'

const articleLayout: LayoutFunction<PageVars> = (args) => {
  const { children, ...rest } = args
  const wrappedChildren = render(html`
    <article class="bc-article h-entry" itemscope itemtype="http://schema.org/NewsArticle">

      <h1>${rest.vars.title}</h1>

      <section class="e-content" itemprop="articleBody">
        ${typeof children === 'string'
          ? html`<div dangerouslySetInnerHTML=${{ __html: children }}></div>`
          : children /* Support both preact and string children */
        }
      </section>
    </article>
  `)

  return defaultRootLayout({ children: wrappedChildren, ...rest })
}

export default articleLayout
