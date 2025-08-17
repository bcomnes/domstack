/**
 * @import { LayoutFunction } from '../../index.js'
 * @import { VNode } from 'preact'
 */
import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

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
 * @type {LayoutFunction<DefaultRootLayoutVars, string | VNode, string>}
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
  return /* html */`
    <!DOCTYPE html>
    <html>
      ${render(html`
        <head>
          <meta charset="utf-8" />
          <title>${title ? `${title}` : ''}${title && siteName ? ' | ' : ''}${siteName}</title>
          <meta name="viewport" content="width=device-width, user-scalable=no" />
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
