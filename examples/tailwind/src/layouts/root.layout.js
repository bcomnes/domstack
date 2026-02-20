/**
 * @import { LayoutFunction } from '@domstack/static'
 */
// @ts-ignore
import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

/**
 * Global layout with Tailwind container styles
 *
 * @type {LayoutFunction<{
 *   title: string,
 *   siteName: string,
 *   defaultStyle: boolean,
 *   basePath: string
 * }>}
 */
export default function defaultRootLayout ({
  vars: {
    title,
    siteName = 'Domstack',
    basePath,
  },
  scripts,
  styles,
  children,
}) {
  return /* html */`
    <!DOCTYPE html>
    <html class="h-full">
      ${render(html`
        <head>
          <meta charset="utf-8" />
          <title>${title ? `${title}` : ''}${title && siteName ? ' | ' : ''}${siteName}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
          ${scripts
            ? scripts.map(script => html`<script type='module' src="${script.startsWith('/') ? `${basePath ?? ''}${script}` : script}" />`)
            : null}
          ${styles
            ? styles.map(style => html`<link rel="stylesheet" href="${style.startsWith('/') ? `${basePath ?? ''}${style}` : style}" />`)
            : null}
        </head>
      `)}
      ${render(html`
        <body class="prose min-h-screen bg-gray-50 text-gray-900 safe-area-inset">
          ${typeof children === 'string'
            ? html`<main class="container mx-auto p-4 mine-layout app-main" dangerouslySetInnerHTML="${{ __html: children }}" />`
            : html`<main class="container mx-auto p-4 mine-layout app-main">${children}</main>`
          }
        </body>
      `)}
    </html>
  `
}
