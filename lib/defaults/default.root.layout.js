/**
 * @import { LayoutFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */
import { html, raw, render } from 'fragtml'

/**
 * @typedef {{
 *   title: string,
 *   siteName: string,
 *   defaultStyle: boolean,
 *   basePath: string
 * }} DefaultRootLayoutVars
 */

/**
 * Build all of the bundles using esbuild.
 *
 * @type {LayoutFunction<DefaultRootLayoutVars, string | HtmlResult, string>}
 */
export default function defaultRootLayout ({
  vars: {
    title,
    siteName = 'domstack',
    basePath,
    /* defaultStyle = true  Set this to false in global or page to disable the default style in the default layout */
  },
  scripts,
  styles,
  children,
  /* pages */
  /* page */
}) {
  return render(html`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title ? `${title}` : ''}${title && siteName ? ' | ' : ''}${siteName}</title>
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
