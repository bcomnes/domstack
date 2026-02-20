import type { LayoutFunction } from '@domstack/static'
import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

import defaultRootLayout from './root.layout.ts'
import type { PageVars } from './root.layout.ts'

export interface BlogVars extends PageVars {
  publishDate?: string;
  updatedDate?: string;
  authorName?: string;
  authorUrl?: string;
  published?: boolean;
}

const blogLayout: LayoutFunction<BlogVars> = (args) => {
  const { children, ...rest } = args
  const { vars } = rest
  const publishDate = vars.publishDate ? new Date(vars.publishDate) : null
  const updatedDate = vars.updatedDate ? new Date(vars.updatedDate) : null

  const wrappedChildren = render(html`
    <article class="blog-article h-entry" itemscope itemtype="http://schema.org/BlogPosting">
      ${vars.published === false
        ? html`<div class="draft-banner"><strong>DRAFT POST</strong></div>`
        : null
      }
      <header class="article-header">
        <h1 class="p-name article-title" itemprop="headline">${vars.title}</h1>
        <div class="article-metadata">
          ${vars.authorName
            ? html`<address class="author-info p-author h-card" itemprop="author" itemscope itemtype="http://schema.org/Person">
                ${vars.authorUrl
                  ? html`<a href="${vars.authorUrl}" class="u-url" itemprop="url">
                      <span itemprop="name">${vars.authorName}</span>
                    </a>`
                  : html`<span itemprop="name">${vars.authorName}</span>`
                }
              </address>`
            : null
          }
          ${publishDate
            ? html`<time class="published-date dt-published" itemprop="datePublished" datetime="${publishDate.toISOString()}">
                ${publishDate.toISOString().split('T')[0]}
              </time>`
            : null
          }
          ${updatedDate
            ? html`<time class="updated-date dt-updated" itemprop="dateModified" datetime="${updatedDate.toISOString()}">
                Updated ${updatedDate.toISOString().split('T')[0]}
              </time>`
            : null
          }
        </div>
      </header>
      <section class="e-content" itemprop="articleBody">
        ${typeof children === 'string'
          ? html`<div dangerouslySetInnerHTML=${{ __html: children }}></div>`
          : children
        }
      </section>
    </article>
  `)

  return defaultRootLayout({ children: wrappedChildren, ...rest })
}

export default blogLayout
