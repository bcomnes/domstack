import { html, render } from 'fragtml'
import type { PageFunction } from '@domstack/static/types.js'
import type { BlogPageData } from '../global.data.js'
import type { SiteVars } from '../global.vars.js'

type Vars = SiteVars

/**
 * Blog index page — lists all posts, newest first.
 * Post data comes from explicit global-data subscriptions.
 */
const blogIndex: PageFunction<Vars, string, BlogPageData> = ({ data }) => {
  const { blogPosts, blogIndexes } = data
  if (blogPosts.length === 0) {
    return '<p>No posts yet.</p>'
  }

  return render(html`
    <div>
      <h1>All Posts</h1>
      <ul class="post-list">
        ${blogPosts.map(post => {
          const date = new Date(post.publishDate)
          return html`
            <li class="post-list-item">
              <h2 class="post-list-title">
                <a href="/${post.path}/">${post.title}</a>
              </h2>
              <p class="post-list-meta">
                <time datetime="${date.toISOString()}">
                  ${date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </time>
                ${post.tags.length > 0 ? html` · ${post.tags.join(', ')}` : null}
              </p>
              ${post.description ? html`<p class="post-list-description">${post.description}</p>` : null}
            </li>
          `
        })}
      </ul>
      <h2>Archive</h2>
      <ul class="archive-list">
        ${blogIndexes.map(index => html`
          <li><a href="/blog/${index.year}/">${index.year}</a></li>
        `)}
      </ul>
    </div>
  `)
}

export default blogIndex

export const vars = {
  title: 'Blog',
  layout: 'root',
  dataDeps: ['blogIndexes', 'blogPosts'] satisfies Array<keyof BlogPageData>,
}
