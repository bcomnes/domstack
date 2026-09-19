import { html, render } from 'fragtml'
import { formatBlogDate, type BlogArchive, type BlogSummary } from './blog.ts'

export function blogIndex (posts: readonly BlogSummary[], archives: readonly Pick<BlogArchive, 'year' | 'url'>[], year?: string): string {
  return render(html`
    <header>
      ${year ? html`<a href="/blog/">← All posts</a>` : null}
      <h1>${year ? `Blog — ${year}` : 'Blog'}</h1>
      <p>${year ? `Posts from the ${year} archive.` : 'Notes on building static websites with DOMStack.'}</p>
      <nav class="blog-feeds" aria-label="Blog feeds"><a href="/feed.json" type="application/feed+json">JSON Feed</a><a href="/feed.xml" type="application/atom+xml">Atom feed</a></nav>
      ${archives.length ? html`<nav class="blog-years" aria-label="Blog archives">${archives.map(archive => html`<a href="${archive.url}" ${archive.year === year ? html`aria-current="page"` : null}>${archive.year}</a>`)}</nav>` : null}
    </header>
    ${posts.length
? html`<ol class="blog-list">${posts.map(post => html`<li><article>
      <h2><a href="${post.url}">${post.title}</a></h2>
      <p class="blog-byline"><span class="blog-authors">${post.authors.map(author => html`<a class="blog-author" rel="author" href="${author.url}"><img src="${author.avatar}" width="24" height="24" alt="" loading="lazy" /><span>${author.name}</span></a>`)}</span><time datetime="${post.publishDate}">${formatBlogDate(post.publishDate)}</time>${post.draft ? html`<span>Draft</span>` : null}</p>
      <p class="blog-summary">${post.description}</p>
    </article></li>`)}</ol>`
: html`<p class="blog-empty">No posts yet. Subscribe to a feed to follow future posts.</p>`}
  `)
}
