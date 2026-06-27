/**
 * @import { LayoutFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */

import { html, raw, render } from 'fragtml'
import { LAYOUT_MARKER } from '../libs/layout-helper.js'

/**
 * @typedef {{
 *   title: string,
 *   siteName: string,
 *   authorImgUrl: string,
 *   authorName: string,
 *   authorUrl: string,
 *   authorImgAlt: string,
 *   publishDate: string,
 *   updatedDate?: string
 * }} SiteVars
 */

/** @type {LayoutFunction<SiteVars, string | HtmlResult, string>} */
export default function defaultRootLayout ({
  vars: {
    title,
    siteName = 'DomStack',
  },
  scripts,
  styles,
  children
}) {
  const pageTitle = title && siteName
    ? `${title} | ${siteName}`
    : title || siteName

  const head = render(html`
    <head>
      <meta charset="utf-8" />
      <title>${pageTitle}</title>
      <meta name="viewport" content="width=device-width, user-scalable=no" />
      <meta itemprop="publisher" content="${siteName}" />
      <meta property="og:site_name" content="${siteName}" />
      ${scripts?.map(script =>
        html`<script type="module" src="${script}"></script>`
      )}
      ${styles?.map(style =>
        html`<link rel="stylesheet" href="${style}" />`
      )}
    </head>
  `)

  const body = render(html`
    <body class="safe-area-inset">
      <main class="mine-layout">
        ${typeof children === 'string' ? raw(children) : children}
      </main>
    </body>
  `)

  return `<!DOCTYPE html>
<html data-marker="${LAYOUT_MARKER}">
  ${head}
  ${body}
</html>`
}
