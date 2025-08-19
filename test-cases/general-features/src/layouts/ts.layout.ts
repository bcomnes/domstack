import defaultRootLayout from './root.layout.js'
import { html } from 'htm/preact'
import type { LayoutFunction } from '../../../../index.js'
import type { SiteVars } from './root.layout.js'

const tsLayout: LayoutFunction<SiteVars> = (layoutVars) => {
  const { children: innerChildren, ...rest } = layoutVars
  const { vars } = layoutVars

  const children = html`
    <article className="article-layout h-entry" itemscope itemtype="http://schema.org/NewsArticle">
      <header className="article-header">
        <h1 className="p-name article-title" itemprop="headline">${vars.title}</h1>
        <div className="metadata">
          <address className="author-info" itemprop="author" itemscope itemtype="http://schema.org/Person">
            ${vars.authorImgUrl
              ? html`<img height="40" width="40" src="${vars.authorImgUrl}" alt="${vars.authorImgAlt}" className="u-photo" itemprop="image" />`
              : null
            }
            ${vars.authorName && vars.authorUrl
              ? html`
                  <a href="${vars.authorUrl}" className="p-author h-card" itemprop="url">
                    <span itemprop="name">${vars.authorName}</span>
                  </a>`
              : null
            }
          </address>
          ${vars.publishDate
            ? html`
                <time className="dt-published" itemprop="datePublished" datetime="${vars.publishDate}">
                  <a href="#" className="u-url">
                    ${(new Date(vars.publishDate)).toLocaleString()}
                  </a>
                </time>`
            : null
          }
          ${vars.updatedDate
            ? html`
                <time className="dt-updated" itemprop="dateModified" datetime="${vars.updatedDate}">
                  Updated ${(new Date(vars.updatedDate)).toLocaleString()}
                </time>`
            : null
          }
        </div>
      </header>

      <section className="e-content" itemprop="articleBody">
        ${typeof innerChildren === 'string'
          ? html`<div dangerouslySetInnerHTML="${{ __html: innerChildren }}" />`
          : innerChildren
        }
      </section>

      <!--
        <footer>
          <p>Footer notes or related info here...</p>
        </footer>
      -->
    </article>
  `

  return defaultRootLayout({
    ...rest,
    children
  })
}

export default tsLayout
