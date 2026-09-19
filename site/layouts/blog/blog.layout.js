/**
 * @import { AsyncLayoutFunction } from '#types'
 * @import { BlogPostVars } from '../../lib/blog.ts'
 */
import { html, raw, render } from 'fragtml'
import { blogYear, formatBlogDate, validateBlogVars } from '../../lib/blog.ts'

export const parentLayout = 'root'

/** @type {AsyncLayoutFunction<BlogPostVars, string, string>} */
export default async function blogLayout ({ vars, children, page }) {
  const post = await validateBlogVars({ ...vars }, page.url)
  const year = blogYear(page.url)
  return render(html`<main class="blog-main" id="main-content"><div class="blog-column"><article class="blog-article">
    <header class="blog-article-meta">
      <nav class="blog-breadcrumb" aria-label="Blog navigation"><a href="/blog/">Blog</a>${year ? html`<span aria-hidden="true"> / </span><a href="/blog/${year}/">${year}</a>` : null}</nav>
      <h1 class="blog-title">${post.title}</h1>
      <p class="blog-byline"><span class="blog-authors">${post.authors.map(author => html`<a class="blog-author" rel="author" href="${author.url}"><img src="${author.avatar}" width="32" height="32" alt="" /><span>${author.name}</span></a>`)}</span><time datetime="${post.publishDate}">${formatBlogDate(post.publishDate)}</time></p>
      ${post.updatedDate ? html`<p class="blog-updated">Updated <time datetime="${post.updatedDate}">${formatBlogDate(post.updatedDate)}</time></p>` : null}
    </header>
    <div class="blog-prose">${raw(children)}</div>
    <footer class="blog-article-footer"><a href="/blog/">← Back to blog</a></footer>
  </article></div></main>`)
}
