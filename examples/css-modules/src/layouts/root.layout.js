/**
 * @import { LayoutFunction } from '@domstack/static/types.js'
 */

import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

/**
 * @typedef {{
 * title: string,
 * siteName: string,
 * basePath?: string,
 }} PageVars
 */

/**
  * @type {LayoutFunction<PageVars>}
  */
export default async function RootLayout ({
  vars: {
    title,
    siteName,
    basePath
  },
  scripts,
  styles,
  children,
}) {
  return /* html */`
    <!DOCTYPE html>
    <html>
      ${render(html`
        <head>
          <meta charset="utf-8" />
          <title>${siteName}${title ? ` | ${title}` : ''}</title>
          <meta name="viewport" content="width=device-width, user-scalable=no" />
          <meta name="color-scheme" content="light dark" />
          ${scripts
            ? scripts.map(script => html`<script type='module' src="${script.startsWith('/') ? `${basePath ?? ''}${script}` : script}" />`)
            : null}
          ${styles
            ? styles.map(style => html`<link rel="stylesheet" href="${style.startsWith('/') ? `${basePath ?? ''}${style}` : style}" />`)
            : null}
        </head>
      `)}
      ${render(html`
        <body className="safe-area-inset">
        ${typeof children === 'string'
            ? html`<main className="mine-layout app-main" dangerouslySetInnerHTML="${{ __html: children }}"/>`
            : html`<main className="mine-layout app-main">${children}</main>`
        }
        </body>
      `)}
    </html>
  `
}
