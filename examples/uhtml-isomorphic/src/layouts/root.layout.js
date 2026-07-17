import { html, render } from 'uhtml-isomorphic'

/**
 * @template {Record<string, any>} T
 * @typedef {import('../build-pages/resolve-layout.js').LayoutFunction<T>} LayoutFunction
 */

/**
 * Build all of the bundles using esbuild.
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
    /* defaultStyle = true  Set this to false in global or page to disable the default style in the default layout */
  },
  scripts,
  styles,
  children,
  /* pages */
  /* page */
}) {
  return render(String, html`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title ? `${title}` : ''}${title && siteName ? ' | ' : ''}${siteName}</title>
        <meta name="viewport" content="width=device-width, user-scalable=no" />
        <meta name="color-scheme" content="light dark" />
        ${scripts
          ? scripts.map(script => html`<script type='module' src="${script.startsWith('/') ? `${basePath ?? ''}${script}` : script}"></script>`)
          : null}
        ${styles
          ? styles.map(style => html`<link rel="stylesheet" href=${style.startsWith('/') ? `${basePath ?? ''}${style}` : style} />`)
          : null}
      </head>
      <body class="safe-area-inset">
        ${typeof children === 'string'
          ? html`<main class="mine-layout app-main">${html([children])}</main>`
          : html`<main class="mine-layout app-main">${children}</main>`
        }
      </body>
    </html>
  `)
}
