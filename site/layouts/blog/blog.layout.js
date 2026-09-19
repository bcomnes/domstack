/**
 * @import { LayoutFunction } from '#types'
 */
import { html, raw, render } from 'fragtml'
import { blogYear, formatBlogDate, validateBlogVars } from '../../lib/blog.ts'

export const parentLayout = 'root'

/** @type {LayoutFunction<Record<string, unknown>, string, string>} */
export default function blogLayout ({ vars, children, page }) {
  const post = validateBlogVars(vars, page.url)
  const year = blogYear(page.url)
  return render(html`<main class="blog-main" id="main-content"><div class="blog-column"><article class="blog-article">
    <header class="blog-article-meta">
      <nav class="blog-breadcrumb" aria-label="Blog navigation"><a href="/blog/">Blog</a>${year ? html`<span aria-hidden="true"> / </span><a href="/blog/${year}/">${year}</a>` : null}</nav>
      <p class="blog-byline"><time datetime="${post.publishDate}">${formatBlogDate(post.publishDate)}</time> · <a rel="author" href="${post.authorUrl}">${post.authorName}</a>${post.updatedDate ? html`<span class="blog-updated">Updated <time datetime="${post.updatedDate}">${formatBlogDate(post.updatedDate)}</time></span>` : null}</p>
    </header>
    <div class="blog-prose">${raw(children)}</div>
    <footer class="blog-article-footer"><a href="/blog/">← Back to blog</a></footer>
  </article></div></main>`)
}
