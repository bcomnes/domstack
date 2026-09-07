import { html, render } from 'fragtml'
import type { AsyncGlobalDataFunction, GlobalDataFunctionParams } from '@domstack/static/types.js'

// Frontmatter is input, not yet a validated feed or archive record.
type SourcePageVars = {
  layout?: string
  title?: unknown
  publishDate?: unknown
  description?: unknown
  tags?: unknown
  redirectFrom?: unknown
}
type SourcePages = GlobalDataFunctionParams<SourcePageVars, unknown>['pages']

export interface BlogPost {
  path: string
  title: string
  publishDate: string
  description: string
  tags: string[]
}

export interface BlogIndex {
  year: number
  posts: BlogPost[]
}

export interface FeedItem extends BlogPost {
  contentHtml: string
}

export interface PageRedirect {
  /** Old same-origin URL path that should redirect. */
  from: string
  /** Current URL of the page that declared the old path. */
  to: string
}

function collectRedirects (pages: SourcePages): PageRedirect[] {
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

function collectBlogPosts (pages: SourcePages): BlogPost[] {
  const blogPosts: BlogPost[] = []

  for (const page of pages) {
    const publishDateValue = page.vars.publishDate
    if (page.vars.layout !== 'post' || (typeof publishDateValue !== 'string' && !(publishDateValue instanceof Date))) continue

    const publishDate = new Date(publishDateValue.valueOf())
    if (Number.isNaN(publishDate.valueOf())) continue

    blogPosts.push({
      path: page.pageInfo.path,
      title: String(page.vars.title ?? 'Untitled'),
      publishDate: publishDate.toISOString(),
      description: String(page.vars.description ?? ''),
      tags: Array.isArray(page.vars.tags) ? page.vars.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    })
  }

  blogPosts.sort((a, b) => b.publishDate.localeCompare(a.publishDate))
  return blogPosts
}

function collectBlogIndexes (blogPosts: BlogPost[]): BlogIndex[] {
  const postsByYear = new Map<number, BlogPost[]>()

  for (const post of blogPosts) {
    const year = new Date(post.publishDate).getUTCFullYear()
    const yearPosts = postsByYear.get(year) ?? []
    yearPosts.push(post)
    postsByYear.set(year, yearPosts)
  }

  const blogIndexes: BlogIndex[] = []
  for (const [year, posts] of postsByYear) {
    blogIndexes.push({ year, posts })
  }

  blogIndexes.sort((a, b) => b.year - a.year)
  return blogIndexes
}

export interface GlobalData {
  /** All blog posts, sorted newest-first. */
  blogPosts: BlogPost[]
  /** Yearly post groups used to generate and render archive pages. */
  blogIndexes: BlogIndex[]
  /** The 5 most recent posts — used by the home page listing. */
  recentPosts: BlogPost[]
  /** Pre-rendered HTML snippet of recent posts. */
  recentPostsHtml: string
  /** tag → posts index, available for tag archive pages. */
  tagIndex: Record<string, BlogPost[]>
  /** Redirects collected from each destination page's redirectFrom metadata. */
  redirects: PageRedirect[]
  /** Feed-ready records with rendered post content. */
  feedItems: FeedItem[]
}

export type BlogPageData = Pick<GlobalData, 'blogIndexes' | 'blogPosts'>
export type BlogIndexesPagesData = Pick<GlobalData, 'blogIndexes'>
export type FeedsTemplateData = Pick<GlobalData, 'feedItems'>
export type RedirectPagesData = Pick<GlobalData, 'redirects'>

const buildGlobalData: AsyncGlobalDataFunction<GlobalData, SourcePageVars, unknown> = async ({ pages }) => {
  const blogPosts = collectBlogPosts(pages)
  const blogIndexes = collectBlogIndexes(blogPosts)
  const redirects = collectRedirects(pages)
  const recentPosts = blogPosts.slice(0, 5)
  const feedItems = await Promise.all(blogPosts.slice(0, 20).map(async post => {
    const page = pages.find(candidate => candidate.pageInfo.path === post.path)
    return {
      ...post,
      contentHtml: page ? String(await page.renderInnerPage()) : '',
    }
  }))

  // Pre-render an HTML snippet for the home page's recentPostsHtml subscription.
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
  const tagIndex: Record<string, BlogPost[]> = Object.create(null)
  for (const post of blogPosts) {
    for (const tag of post.tags) {
      if (!tagIndex[tag]) tagIndex[tag] = []
      tagIndex[tag].push(post)
    }
  }

  return { blogPosts, blogIndexes, recentPosts, recentPostsHtml, tagIndex, redirects, feedItems }
}

export default buildGlobalData
