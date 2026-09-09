/** @import { HtmlResult } from 'fragtml/types.js' */
import { posix } from 'node:path'
import { load } from 'cheerio'
import { html } from 'fragtml'

/**
 * @typedef {object} NavigationEntry
 * @property {string} title
 * @property {string} url Canonical page URL, including a fragment for headings.
 * @property {NavigationEntry[]} sections
 */

export const docsIndexUrl = '/docs/'
const siteOrigin = 'https://docs.invalid'

/**
 * The index's explicit page list controls membership, order, and page-only links; rendered
 * Markdown supplies titles and real anchor IDs, including custom/duplicate IDs.
 *
 * @param {{ pageInfo: { url: string, type: string }, renderInnerPage: () => Promise<unknown> }[]} pages
 * @returns {Promise<NavigationEntry[]>}
 */
export async function collectDocsNavigation (pages) {
  const docs = new Map(pages
    .filter(page => page.pageInfo.type === 'md' && page.pageInfo.url.startsWith(docsIndexUrl))
    .map(page => [page.pageInfo.url, page]))
  const index = docs.get(docsIndexUrl)
  if (!index) throw new Error('Documentation navigation requires /docs/')
  const $ = load(String(await index.renderInnerPage()))
  const links = $('.docs-index li > a').toArray()
  if (!links.length) throw new Error('Documentation navigation requires a page list in .docs-index')
  const seen = new Set()

  return Promise.all(links.map(async link => {
    const url = new URL($(link).attr('href') ?? '', siteOrigin + docsIndexUrl)
    const page = docs.get(url.pathname)
    if (url.origin !== siteOrigin || url.hash || url.search || !page || page === index) {
      throw new Error(`Invalid documentation index page: ${url.href}`)
    }
    if (seen.has(url.pathname)) throw new Error(`Duplicate documentation index page: ${url.pathname}`)
    seen.add(url.pathname)
    const document = load(String(await page.renderInnerPage()))
    /** @type {NavigationEntry[]} */
    const sections = []
    /** @type {NavigationEntry | undefined} */
    let parent
    const headings = $(link).attr('data-navigation') === 'page-only' ? document([]) : document('h2[id], h3[id]')
    headings.each((_, heading) => {
      const title = document(heading).text().trim()
      if (title.toLowerCase() === 'table of contents') return
      const section = {
        title,
        url: `${url.pathname}#${encodeURIComponent(document(heading).attr('id') ?? '')}`,
        sections: [],
      }
      if (heading.tagName === 'h3' && parent) {
        parent.sections.push(section)
      } else {
        sections.push(section)
      }
      if (heading.tagName === 'h2') parent = section
    })
    return {
      title: document('h1').first().text().trim() || $(link).text().trim(),
      url: url.pathname,
      sections,
    }
  }))
}

/**
 * Relative links preserve deployment prefixes without needing a configured
 * base URL. This also handles flat pages such as /docs/v12-migration.html.
 * @param {string} from Canonical current page URL.
 * @param {string} to Canonical target URL, optionally with a fragment.
 */
export function navigationHref (from, to) {
  const target = new URL(to, siteOrigin)
  const directory = from.endsWith('/') ? from : posix.dirname(from)
  let path = posix.relative(directory, target.pathname)
  if (path && target.pathname.endsWith('/')) path += '/'
  return `${path || './'}${target.hash}`
}

/** @param {NavigationEntry[]} entries @param {string} pageUrl @returns {HtmlResult} */
export function sectionLinks (entries, pageUrl) {
  return html`
    <ul>
      ${entries.map(entry => html`
        <li>
          <a href="${navigationHref(pageUrl, entry.url)}">${entry.title}</a>
          ${entry.sections.length ? sectionLinks(entry.sections, pageUrl) : ''}
        </li>
      `)}
    </ul>
  `
}
