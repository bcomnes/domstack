/**
 * @import { LayoutFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */

import { html, raw, render } from 'fragtml'

export const vars = {
  dataDeps: ['sourcePageCount'],
}

/** @type {LayoutFunction<{ title: string }, string | HtmlResult, string, { sourcePageCount: number }>} */
export default function rootLayout ({ vars, data, styles = [], scripts = [], children }) {
  return render(html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${vars.title}</title>
  ${styles.map(href => html`<link rel="stylesheet" href="${href}">`)}
  ${scripts.map(src => html`<script type="module" src="${src}"></script>`)}
  <meta name="source-page-count" content="${data.sourcePageCount ?? 0}">
</head>
<body>
  <main>${typeof children === 'string' ? raw(children) : children}</main>
</body>
</html>`)
}
