import { html, render } from 'fragtml'
import type { AsyncGlobalDataFunction, GlobalDataFunctionParams } from '@domstack/static/types.js'

export interface BlogPost {
  path: string
  title: string
  publishDate: string
  description: string
  tags: string[]
}

export interface PageRedirect {
  /** Old same-origin URL path that should redirect. */
  from: string
  /** Current URL of the page that declared the old path. */
  to: string
}

export function collectRedirects (pages: GlobalDataFunctionParams['pages']): PageRedirect[] {
  const redirects: PageRedirect[] = []
  const redirectOwners = new Map<string, string>()

  for (const page of pages) {
    const redirectFrom = page.vars.redirectFrom
    if (redirectFrom === undefined) continue

    const source = page.pageInfo.pageFile.relname
    if (!Array.isArray(redirectFrom)) throw new TypeError(`redirectFrom on "${source}" must be an array of same-origin URL paths`)

    for (const from of redirectFrom) {
      if (typeof from !== 'string') throw new TypeError(`redirectFrom entries on "${source}" must be strings`)
      if (from.trim() !== from || !from.startsWith('/') || from.startsWith('//')) throw new Error(`Invalid redirectFrom "${from}" on "${source}": expected a same-origin URL path beginning with "/"`)
      if (from.includes('?') || from.includes('#')) throw new Error(`Invalid redirectFrom "${from}" on "${source}": queries and fragments are not supported`)
      if (from.includes('\\') || from.split('/').some(part => part === '.' || part === '..')) throw new Error(`Invalid redirectFrom "${from}" on "${source}": path must not contain ".", "..", or backslash segments`)

      const existingSource = redirectOwners.get(from)
      if (existingSource) {
        const detail = existingSource === source
          ? `more than once on "${source}"`
          : `by both "${existingSource}" and "${source}"`
        throw new Error(`redirectFrom "${from}" is declared ${detail}`)
      }

      redirectOwners.set(from, source)
      redirects.push({ from, to: page.pageInfo.url })
    }
  }

  return redirects
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
  /** Redirects collected from each destination page's redirectFrom metadata. */
  redirects: PageRedirect[]
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

  const redirects = collectRedirects(pages)
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

  return { blogPosts, recentPosts, recentPostsHtml, tagIndex, redirects }
}

export default buildGlobalData
