// @ts-ignore
import { html, raw, render } from 'fragtml'

/**
 * @template {Record<string, any>} T
 * @typedef {import('../build-pages/resolve-layout.js').LayoutFunction<T>} LayoutFunction
 */

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
  return render(html`
    <!DOCTYPE html>
    <html class="h-full">
      <head>
        <meta charset="utf-8" />
        <title>${title ? `${title}` : ''}${title && siteName ? ' | ' : ''}${siteName}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
        ${scripts
          ? scripts.map(script => html`<script type="module" src="${script.startsWith('/') ? `${basePath ?? ''}${script}` : script}"></script>`)
          : null}
        ${styles
          ? styles.map(style => html`<link rel="stylesheet" href="${style.startsWith('/') ? `${basePath ?? ''}${style}` : style}" />`)
          : null}
      </head>
      <body class="prose min-h-screen bg-gray-50 text-gray-900 safe-area-inset">
        <main class="container mx-auto p-4 mine-layout app-main">${typeof children === 'string' ? raw(children) : children}</main>
      </body>
    </html>
  `)
}
