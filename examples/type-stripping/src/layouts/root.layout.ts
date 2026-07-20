import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

import type { LayoutFunction } from '@domstack/static/types.js'

interface Vars {
  title?: string
  siteName?: string
  defaultStyle?: boolean
  basePath?: string
}

type DefaultRootLayout = LayoutFunction<Vars>

const defaultRootLayout: DefaultRootLayout = ({
  vars: {
    title,
    siteName = 'Domstack',
    basePath,
  },
  scripts,
  styles,
  children,
}) => /* html */`
    <!DOCTYPE html>
    <html>
      ${render(html`
        <head>
          <meta charset="utf-8" />
          <title>${title ? `${title}` : ''}${title && siteName ? ' | ' : ''}${siteName}</title>
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
        <body class="safe-area-inset">
          ${typeof children === 'string'
            ? html`<main class="mine-layout app-main" dangerouslySetInnerHTML="${{ __html: children }}"/>`
            : html`<main class="mine-layout app-main">${children}</main>`
          }
        </body>
      `)}
    </html>
  `

export default defaultRootLayout
