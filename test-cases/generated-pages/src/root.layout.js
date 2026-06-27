/**
 * @import { LayoutFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */

import { html, raw, render } from 'fragtml'

/** @type {LayoutFunction<{ title: string, generatedPageCount?: number }, string | HtmlResult, string>} */
export default function rootLayout ({ vars, styles = [], scripts = [], children }) {
  return render(html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${vars.title}</title>
  ${styles.map(href => html`<link rel="stylesheet" href="${href}">`)}
  ${scripts.map(src => html`<script type="module" src="${src}"></script>`)}
  <meta name="generated-page-count" content="${vars.generatedPageCount ?? 0}">
</head>
<body>
  <main>${typeof children === 'string' ? raw(children) : children}</main>
</body>
</html>`)
}
