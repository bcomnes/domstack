import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'
import type { AsyncGlobalDataFunction } from '@domstack/static'

export interface BlogPost {
  path: string
  title: string
  publishDate: string
  description: string
  tags: string[]
}

export interface GlobalData {
  /** All blog posts, sorted newest-first. Available to every page and template. */
  blogPosts: BlogPost[]
  /** The 5 most recent posts — used by the home page listing. */
  recentPosts: BlogPost[]
  /** Pre-rendered HTML snippet of recent posts — drop into a page with {{{ vars.recentPostsHtml }}} */
  recentPostsHtml: string
  /** tag → posts index, available for tag archive pages. */
  tagIndex: Record<string, BlogPost[]>
}

const buildGlobalData: AsyncGlobalDataFunction<GlobalData> = async ({ pages }) => {
  const blogPosts: BlogPost[] = pages
    .filter(p => p.vars?.layout === 'post' && p.vars?.publishDate)
    .map(p => ({
      path: p.pageInfo.path,
      title: String(p.vars?.title ?? 'Untitled'),
      publishDate: String(p.vars?.publishDate),
      description: String(p.vars?.description ?? ''),
      tags: Array.isArray(p.vars?.tags) ? (p.vars.tags as string[]) : [],
    }))
    .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime())

  const recentPosts = blogPosts.slice(0, 5)

  // Pre-render an HTML snippet for use on the home page via handlebars {{{ vars.recentPostsHtml }}}
  const recentPostsHtml = render(html`
    <ul class="post-list">
      ${recentPosts.map(post => {
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
  `)

  // Build a tag → posts index available to any page that wants it
  const tagIndex: Record<string, BlogPost[]> = {}
  for (const post of blogPosts) {
    for (const tag of post.tags) {
      if (!tagIndex[tag]) tagIndex[tag] = []
      tagIndex[tag].push(post)
    }
  }

  return { blogPosts, recentPosts, recentPostsHtml, tagIndex }
}

export default buildGlobalData
