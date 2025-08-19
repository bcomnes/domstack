/**
 * @import { LayoutFunction } from '../../../../index.js'
 */

import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

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

/** @type {LayoutFunction<SiteVars>} */
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
        html`<script type="module" src="${script}" />`
      )}
      ${styles?.map(style =>
        html`<link rel="stylesheet" href="${style}" />`
      )}
    </head>
  `)

  const body = render(html`
    <body className="safe-area-inset">
      <main className="mine-layout">
        ${typeof children === 'string'
          ? html`<div dangerouslySetInnerHTML="${{ __html: children }}" />`
          : children
        }
      </main>
    </body>
  `)

  return `<!DOCTYPE html>
<html>
  ${head}
  ${body}
</html>`
}
