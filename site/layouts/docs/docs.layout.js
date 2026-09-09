/**
 * @import { LayoutFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 * @import { NavigationEntry } from './navigation.js'
 */
import { html, raw, render } from 'fragtml'
import { load } from 'cheerio'
import { docsIndexUrl, navigationHref, sectionLinks } from './navigation.js'

export const parentLayout = 'root'
export const vars = { dataDeps: ['docsNavigation'] }

/** @param {string} url The canonical page URL, without a deployment base path. */
export function breadcrumb (url) {
  const segments = url.split('/').filter(Boolean)
  const isDirectory = url.endsWith('/')
  const depth = segments.length - (isDirectory ? 0 : 1)

  return html`
    <nav class="docs-breadcrumb" aria-label="Breadcrumb">
      <ol>
        <li><a href="${'../'.repeat(depth) || './'}">Home</a></li>
        ${segments.map((segment, index) => {
          const current = index === segments.length - 1
          const label = current && !isDirectory ? segment.replace(/\.html$/, '') : segment
          return html`
            <li>${current
              ? html`<span aria-current="page">${label}</span>`
              : html`<a href="${'../'.repeat(depth - index - 1) || './'}">${label}</a>`
            }</li>`
        })}
      </ol>
    </nav>`
}

/** @param {NavigationEntry[]} entries @param {string} pageUrl */
export function navigation (entries, pageUrl) {
  return html`
    <details class="docs-navigation" id="table-of-contents" open>
      <summary>Documentation contents</summary>
      <nav aria-label="Documentation">
        <a href="${navigationHref(pageUrl, docsIndexUrl)}"
          ${pageUrl === docsIndexUrl ? raw('aria-current="page"') : ''}>All documentation</a>
        <ul>
          ${entries.map(entry => {
            const current = entry.url === pageUrl
            const link = html`<a href="${navigationHref(pageUrl, entry.url)}"
              ${current ? raw('aria-current="page"') : ''}>${entry.title}</a>`
            if (!entry.sections.length) return html`<li>${link}</li>`
            return html`
              <li>
                <details ${current ? raw('open') : ''}>
                  <summary>${link}</summary>
                  ${sectionLinks(entry.sections, pageUrl)}
                </details>
              </li>
            `
          })}
        </ul>
      </nav>
    </details>
  `
}

/**
 * Keep Markdown's local ToCs useful on GitHub, but replace them on the website.
 * Parsing only inner content also keeps the shared navigation out of itself.
 * @param {string} content
 * @param {NavigationEntry[]} entries
 * @param {string} pageUrl
 */
export function documentationContent (content, entries, pageUrl) {
  const $ = load(content, {}, false)
  $('.table-of-contents').each((_, toc) => {
    const heading = $(toc).prev()
    if (heading.is('h2, h3') && heading.text().trim().toLowerCase() === 'table of contents') heading.remove()
    $(toc).remove()
  })
  if (pageUrl === docsIndexUrl) {
    const entriesByUrl = new Map(entries.map(entry => [entry.url, entry]))
    $('.docs-index li > a').each((_, link) => {
      const url = new URL($(link).attr('href') ?? '', `https://docs.invalid${pageUrl}`)
      const entry = entriesByUrl.get(url.pathname)
      if (entry?.sections.length) $(link).after(render(sectionLinks(entry.sections, pageUrl)))
    })
  }
  return raw($.html())
}

/** @type {LayoutFunction<Record<string, never>, string | HtmlResult, HtmlResult, { docsNavigation: NavigationEntry[] }>} */
export default function docsLayout ({ children, page, data }) {
  return html`
    <div class="docs-shell">
      ${navigation(data.docsNavigation, page.url)}
      <main class="docs-content" id="docs-content" tabindex="-1">
        ${breadcrumb(page.url)}
        ${documentationContent(typeof children === 'string' ? children : render(children), data.docsNavigation, page.url)}
      </main>
      <dialog class="docs-menu" id="docs-menu" aria-labelledby="docs-menu-title">
        <div class="docs-menu-header">
          <span id="docs-menu-title">Documentation</span>
          <form method="dialog"><button type="submit" autofocus aria-label="Close documentation menu">Close <span aria-hidden="true">×</span></button></form>
        </div>
      </dialog>
    </div>
  `
}
