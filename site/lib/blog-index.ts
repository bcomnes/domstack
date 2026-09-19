import { html, render } from 'fragtml'
import { formatBlogDate, type BlogArchive, type BlogSummary } from './blog.ts'

export function blogIndex (posts: readonly BlogSummary[], archives: readonly Pick<BlogArchive, 'year' | 'url'>[], year?: string): string {
  return render(html`
    <header class="blog-index-header">
      <div class="blog-index-heading">
        <h1>${year ? `Blog — ${year}` : 'Blog'}</h1>
        <nav class="blog-feeds" aria-label="Blog feeds"><a href="/feed.json" rel="alternate" type="application/feed+json" title="Subscribe via JSON Feed"><img src="/blog/jsonfeed.svg" width="24" height="24" alt="JSON Feed" /></a><a href="/feed.xml" rel="alternate" type="application/atom+xml" title="Subscribe via Atom"><img src="/blog/atom.svg" width="24" height="24" alt="Atom feed" /></a></nav>
      </div>
      <p class="blog-index-description">${year ? `Posts from the ${year} archive.` : 'Notes on building static websites with DOMStack.'}</p>
      ${archives.length ? html`<nav class="blog-years" aria-label="Blog archives"><a href="/blog/" ${!year ? html`aria-current="page"` : null}>All posts</a>${archives.map(archive => html`<a href="${archive.url}" ${archive.year === year ? html`aria-current="page"` : null}>${archive.year}</a>`)}</nav>` : null}
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
