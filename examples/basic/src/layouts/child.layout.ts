import type { LayoutFunction } from '@domstack/static/types.js'
import { html, raw, render } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'

import type { PageVars } from './root.layout.ts'

export const parentLayout = 'root'

export type ArticleVars = PageVars & {
  readingMinutes: number
  badge: {
    label: string
    tone: 'info' | 'tip'
  }
}

declare module '@domstack/static/types.js' {
  interface LayoutRegistry {
    child: {
      parentLayout: typeof parentLayout
      vars: typeof vars
      render: typeof articleLayout
    }
  }
}

export const vars = async () => ({
  theme: 'dark',
  readingMinutes: 4,
  badge: { label: 'Guide', tone: 'info' },
} satisfies Pick<ArticleVars, 'theme' | 'readingMinutes' | 'badge'>)

const articleLayout: LayoutFunction<ArticleVars, string | HtmlResult, string> = ({ children, vars }) => {
  return render(html`
    <article class="bc-article h-entry" itemscope itemtype="http://schema.org/NewsArticle">

      <h1>${vars.title}</h1>
      <p class="article-meta">
        <span data-tone="${vars.badge.tone}">${vars.badge.label}</span>
        · ${vars.readingMinutes} min read · ${vars.theme} theme
      </p>

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
