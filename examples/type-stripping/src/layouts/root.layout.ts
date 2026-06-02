import { html, raw, render } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'

import type { LayoutFunction } from '@domstack/static/types.js'

interface Vars {
  title?: string
  siteName?: string
  defaultStyle?: boolean
  basePath?: string
}

type DefaultRootLayout = LayoutFunction<Vars, string | HtmlResult, string>

const defaultRootLayout: DefaultRootLayout = ({
  vars: {
    title,
    siteName = 'Domstack',
    basePath,
  },
  scripts,
  styles,
  children,
}) => render(html`
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

export default defaultRootLayout
