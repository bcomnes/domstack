import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'
import type { LayoutFunction } from '@domstack/static'
import rootLayout from './root.layout.ts'
import type { RootVars } from './root.layout.ts'

export type PostVars = RootVars & {
  publishDate?: string
  updatedDate?: string
  description?: string
  tags?: string[]
}

/**
 * Blog post layout. Wraps root layout with full article chrome:
 * schema.org/h-entry microformats, publish date, author card, tag list.
 */
const postLayout: LayoutFunction<PostVars> = (args) => {
  const { children, page, pages, ...rest } = args
  const { vars } = args

  const publishDate = vars.publishDate ? new Date(vars.publishDate) : null
  const updatedDate = vars.updatedDate ? new Date(vars.updatedDate) : null

  const wrappedChildren = render(html`
    <article class="h-entry" itemscope itemtype="https://schema.org/BlogPosting">

      <header class="post-header">
        <h1 class="p-name post-title" itemprop="headline">${vars.title}</h1>

        <div class="post-meta">

          ${/* Author card */''}
          <address class="p-author h-card author-card" rel="author"
            itemprop="author" itemscope itemtype="https://schema.org/Person">
            <a class="u-url p-name author-name" href="${vars.authorUrl}" itemprop="url">
              <span itemprop="name">${vars.authorName}</span>
            </a>
            ${vars.authorBio
              ? html`<span class="p-note author-bio">${vars.authorBio}</span>`
              : null
            }
          </address>

          ${/* Publish date */''}
          ${publishDate ? html`
            <time class="dt-published post-date" itemprop="datePublished"
              datetime="${publishDate.toISOString()}">
              ${publishDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </time>
          ` : null}

          ${/* Updated date */''}
          ${updatedDate ? html`
            <time class="dt-updated post-updated" itemprop="dateModified"
              datetime="${updatedDate.toISOString()}">
              Updated ${updatedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </time>
          ` : null}

          ${/* Tags */''}
          ${vars.tags && vars.tags.length > 0 ? html`
            <ul class="post-tags">
              ${vars.tags.map(tag => html`
                <li><span class="p-category post-tag">${tag}</span></li>
              `)}
            </ul>
          ` : null}

        </div>
      </header>

      <div class="e-content post-body" itemprop="articleBody">
        ${typeof children === 'string'
          ? html`<div dangerouslySetInnerHTML=${{ __html: children }} />`
          : children
        }
      </div>

      <footer class="post-footer">
        <p class="post-footer-note">
          <a class="u-url" href="/${page.path}/">Permalink</a>
        </p>
      </footer>

    </article>
  `)

  return rootLayout({ ...rest, page, pages, children: wrappedChildren })
}

export default postLayout
