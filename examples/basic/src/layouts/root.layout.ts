// The root.layout.ts file must return the rendered page.
// It must implement the following variables:
//
// - children: the string or type that the page returns that represents the inner-content of the page
// - scripts: an array of urls that should be injected into the page as script tags, type module
// - styles: an array of urls that should be injected into the page as link rel="stylesheet" tags.
//
// All other variables are set on a page level basis, either by hand or by data extraction from the page type.

import { html, raw, render } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'
import type { LayoutFunction } from '@domstack/static/types.js'

export interface PageVars {
  title: string;
  siteName: string;
  basePath?: string;
}

const RootLayout: LayoutFunction<PageVars, string | HtmlResult, string> = async ({
  vars: {
    title,
    siteName,
    basePath
  },
  scripts,
  styles,
  children,
}) => {
  return render(html`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${siteName}${title ? ` | ${title}` : ''}</title>
        <meta name="viewport" content="width=device-width, user-scalable=no" />
        <meta name="color-scheme" content="light dark" />
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

export default RootLayout
