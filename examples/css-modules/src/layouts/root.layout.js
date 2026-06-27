/**
 * @import { LayoutFunction } from '@domstack/static/types.js'
 * @import { HtmlResult } from 'fragtml/types.js'
 */

import { html, raw, render } from 'fragtml'

/**
 * @typedef {{
 * title: string,
 * siteName: string,
 * basePath?: string,
 }} PageVars
 */

/**
  * @type {LayoutFunction<PageVars, string | HtmlResult, string>}
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
  return render(html`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${siteName}${title ? ` | ${title}` : ''}</title>
        <meta name="viewport" content="width=device-width, user-scalable=no" />
        ${scripts
          ? scripts.map(script => html`<script type="module" src="${script.startsWith('/') ? `${basePath ?? ''}${script}` : script}"></script>`)
          : null}
        ${styles
          ? styles.map(style => html`<link rel="stylesheet" href="${style.startsWith('/') ? `${basePath ?? ''}${style}` : style}" />`)
          : null}
      </head>
      <body class="safe-area-inset">
        <main class="mine-layout app-main">${typeof children === 'string' ? raw(children) : children}</main>
      </body>
    </html>
  `)
}
