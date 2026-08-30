/**
 * @import { GlobalDataFunction, PageData } from '#types'
 */

/**
 * @typedef {object} BlogPost
 * @property {string} path
 * @property {string} url
 * @property {string} title
 * @property {string} publishDate
 */

/**
 * @typedef {object} Redirect
 * @property {string} from
 * @property {string} to
 */

/**
 * @typedef {object} BlogData
 * @property {BlogPost[]} blogPosts
 * @property {Redirect[]} redirects
 * @property {number} sourcePageCount
 */

/**
 * @param {PageData<any, any, any>[]} pages
 * @returns {Redirect[]}
 */
export function collectRedirects (pages) {
  /** @type {Redirect[]} */
  const redirects = []
  /** @type {Map<string, string>} */
  const redirectOwners = new Map()

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

/** @type {GlobalDataFunction<BlogData>} */
export default function globalData ({ pages }) {
  /** @type {BlogPost[]} */
  const blogPosts = []
  const redirects = collectRedirects(pages)

  for (const page of pages) {
    const publishDateValue = page.vars.publishDate
    if (!page.pageInfo.path.startsWith('blog/') || (typeof publishDateValue !== 'string' && !(publishDateValue instanceof Date))) continue

    const publishDate = new Date(publishDateValue.valueOf())
    if (Number.isNaN(publishDate.valueOf())) continue

    blogPosts.push({
      path: page.pageInfo.path,
      url: page.pageInfo.url,
      title: String(page.vars.title ?? 'Untitled'),
      publishDate: publishDate.toISOString(),
    })
  }

  blogPosts.sort((a, b) => b.publishDate.localeCompare(a.publishDate))

  return {
    blogPosts,
    redirects,
    sourcePageCount: pages.length,
  }
}
