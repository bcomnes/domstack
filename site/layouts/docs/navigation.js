/**
 * @import { PageData, PageInfo } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */
import { posix } from 'node:path'
import { load } from 'cheerio'
import { html, raw } from 'fragtml'

/**
 * @typedef {object} DocsPageVars
 * @property {number} [docsOrder] Navigation order; unordered pages follow ordered pages.
 * @property {string} [docsGroup] Optional index group.
 * @property {string} [docsParent] Canonical ancestor page URL to nest beneath.
 * @property {boolean} [docsPageOnly] Omit section links for this page.
 * @property {string} [title]
 */

/**
 * @typedef {Pick<PageData<DocsPageVars>, 'vars' | 'renderInnerPage'> & {
 *   pageInfo: Pick<PageInfo, 'url' | 'type'>
 * }} NavigationPage
 */

/**
 * @typedef {object} NavigationEntry
 * @property {string} title
 * @property {string} url Canonical page URL, including a fragment for headings.
 * @property {NavigationEntry[]} sections
 * @property {string} [group]
 */

/**
 * Per-source derived data, before child pages are attached to their parents.
 * @typedef {object} DocsNavigationRecord
 * @property {NavigationEntry} entry
 * @property {number} order
 * @property {string | undefined} parent
 */

/** @typedef {Map<string, DocsNavigationRecord>} DocsNavigationIndex */

export const docsIndexUrl = '/docs/'
const siteOrigin = 'https://docs.invalid'

/**
 * Discover source Markdown pages without rendering the index that consumes this data.
 * Page vars control ordering and grouping; rendered Markdown supplies titles and real anchor IDs.
 *
 * @param {NavigationPage[]} pages
 * @returns {Promise<NavigationEntry[]>}
 */
export async function collectDocsNavigation (pages) {
  const records = await Promise.all(pages.map(readDocsNavigationPage))
  return projectDocsNavigation(records.filter(record => record !== undefined))
}

/**
 * Render and parse just one eligible source page. Never retain PageData, parsed
 * documents, or renderer functions in the cross-worker application index.
 * @param {NavigationPage} page
 * @returns {Promise<DocsNavigationRecord | undefined>}
 */
export async function readDocsNavigationPage (page) {
  const url = page.pageInfo.url
  if (page.pageInfo.type !== 'md' || !url.startsWith(docsIndexUrl) || url === docsIndexUrl) return
  const document = load(String(await page.renderInnerPage()))
  /** @type {NavigationEntry[]} */
  const sections = []
  /** @type {NavigationEntry | undefined} */
  let parent
  const headings = page.vars.docsPageOnly ? document([]) : document('h2[id], h3[id]')
  headings.each((_, heading) => {
    const title = document(heading).text().trim()
    if (title.toLowerCase() === 'table of contents') return
    const section = {
      title,
      url: `${url}#${encodeURIComponent(document(heading).attr('id') ?? '')}`,
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
    entry: {
      title: document('h1').first().text().trim() || page.vars.title || url,
      url,
      sections,
      ...(page.vars.docsGroup ? { group: page.vars.docsGroup } : {}),
    },
    order: page.vars.docsOrder ?? Infinity,
    parent: page.vars.docsParent,
  }
}

/**
 * Regenerate public ordering and nesting without reading or rendering sources.
 * @param {Iterable<DocsNavigationRecord>} records
 * @returns {NavigationEntry[]}
 */
export function projectDocsNavigation (records) {
  const docs = [...records].sort((a, b) => {
    const group = (a.entry.group ?? '').localeCompare(b.entry.group ?? '')
    if (group) return group
    const order = a.order - b.order
    return order || a.entry.url.localeCompare(b.entry.url)
  })
  // Nest only fresh entries: attaching child pages to cached heading arrays would
  // duplicate children on the next build and keep deleted/reparented docs alive.
  const entries = docs.map(record => structuredClone(record.entry))
  const entriesByUrl = new Map(entries.map(entry => [entry.url, entry]))
  const parentsByUrl = new Map(docs.map(record => [record.entry.url, record.parent]))
  /** @type {NavigationEntry[]} */
  const roots = []
  for (const entry of entries) {
    const parentUrl = parentsByUrl.get(entry.url)
    if (!parentUrl) {
      roots.push(entry)
      continue
    }
    const parent = entriesByUrl.get(parentUrl)
    if (!parent || !parentUrl.endsWith('/') || entry.url === parentUrl || !entry.url.startsWith(parentUrl)) {
      throw new Error(`Invalid documentation parent for ${entry.url}: ${parentUrl}`)
    }
    parent.sections.push(entry)
  }
  return roots
}

/** @param {NavigationEntry[]} entries @returns {HtmlResult} */
export function docsIndex (entries) {
  /** @type {Map<string, NavigationEntry[]>} */
  const groups = new Map()
  for (const entry of entries) {
    const name = entry.group ?? ''
    const group = groups.get(name)
    if (group) group.push(entry)
    else groups.set(name, [entry])
  }
  return html`
    <div class="docs-index">
      ${Array.from(groups, ([name, pages]) => html`
        ${name ? html`<h2 id="${name.toLowerCase().replace(/\s+/g, '-')}">${name}</h2>` : ''}
        ${sectionLinks(pages, docsIndexUrl)}
      `)}
    </div>
  `
}

/**
 * Relative links preserve deployment prefixes without needing a configured
 * base URL. This also handles flat pages such as /docs/migrations/v12-migration.html.
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
          <a href="${navigationHref(pageUrl, entry.url)}"
            ${entry.url === pageUrl ? raw('aria-current="page"') : ''}>${entry.title}</a>
          ${entry.sections.length ? sectionLinks(entry.sections, pageUrl) : ''}
        </li>
      `)}
    </ul>
  `
}
