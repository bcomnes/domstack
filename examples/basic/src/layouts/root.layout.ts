// The root.layout.ts file must return the rendered page.
// It must implement the following variables:
//
// - children: the string or type that the page returns that represents the inner-content of the page
// - scripts: an array of urls that should be injected into the page as script tags, type module
// - styles: an array of urls that should be injected into the page as link rel="stylesheet" tags.
//
// All other variables are set on a page level basis, either by hand or by data extraction from the page type.

import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'
import type { LayoutFunction } from '@domstack/static/types.js'

export interface PageVars {
  title: string;
  siteName: string;
  basePath?: string;
}

const RootLayout: LayoutFunction<PageVars> = async ({
  vars: {
    title,
    siteName,
    basePath
  },
  scripts,
  styles,
  children,
}) => {
  return /* html */`
    <!DOCTYPE html>
    <html>
      ${render(html`
        <head>
          <meta charset="utf-8" />
          <title>${siteName}${title ? ` | ${title}` : ''}</title>
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

export default RootLayout
