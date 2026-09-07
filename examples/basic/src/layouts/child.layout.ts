import type { LayoutFunction } from '@domstack/static/types.js'
import { html, raw, render } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'

import type { PageVars } from './root.layout.ts'

export const parentLayout = 'root'

const articleLayout: LayoutFunction<PageVars, string | HtmlResult, string> = ({ children, vars }) => {
  return render(html`
    <article class="bc-article h-entry" itemscope itemtype="http://schema.org/NewsArticle">

      <h1>${vars.title}</h1>

      <section class="e-content" itemprop="articleBody">
        ${typeof children === 'string'
          ? html`<div>${raw(children)}</div>`
          : children
        }
      </section>
    </article>
  `)
}

export default articleLayout
