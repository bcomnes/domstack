import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'
import type { PageFunction } from '@domstack/static'
import type { GlobalData } from '../global.data.js'
import type { SiteVars } from '../global.vars.js'

type Vars = SiteVars & GlobalData

/**
 * Blog index page — lists all posts, newest first.
 * Post data comes entirely from global.data.ts via vars.blogPosts.
 * No postVars, no manual wiring needed here.
 */
const blogIndex: PageFunction<Vars> = ({ vars }) => {
  const { blogPosts } = vars

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
    </div>
  `)
}

export default blogIndex

export const vars = {
  title: 'Blog',
  layout: 'root',
}
