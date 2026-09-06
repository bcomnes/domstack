/**
 * @import { LayoutFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */
import { html, raw } from 'fragtml'

export const parentLayout = 'root'

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

/** @type {LayoutFunction<Record<string, never>, string | HtmlResult, HtmlResult>} */
export default function docsLayout ({ children, page }) {
  return html`
    ${breadcrumb(page.url)}
    ${typeof children === 'string' ? raw(children) : children}
    ${breadcrumb(page.url)}
  `
}
