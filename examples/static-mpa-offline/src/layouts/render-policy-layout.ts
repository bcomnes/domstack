import { html, raw, render } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.ts'

/**
 * Shared HTML shell used by the offline-policy demo layouts.
 *
 * Individual layouts provide policy vars and body classes; this helper owns the
 * common document structure, stylesheet/script tags, home navigation, and child
 * rendering for both Markdown and HTML page sources.
 */
export function renderPolicyLayout ({
  bodyClass,
  children,
  scripts,
  styles,
  title,
}: {
  bodyClass: string
  children: string | HtmlResult
  scripts?: string[]
  styles?: string[]
  title: unknown
}): string {
  const head = html`
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${String(title)}</title>
      ${styles?.map(style => html`<link rel="stylesheet" href=${style} />`)}
      ${scripts?.map(script => html`<script type="module" src=${script}></script>`)}
    </head>
  `

  const body = html`
    <body class=${bodyClass}>
      <nav class="example-navigation mine-layout" aria-label="Example navigation">
        <a class="home-button" href="/">Home</a>
      </nav>
      <main class="mine-layout">
        ${typeof children === 'string' ? raw(children) : children}
      </main>
    </body>
  `

  return render(html`
    <!doctype html>
    <html lang="en">
      ${head}
      ${body}
    </html>`)
}
