/**
 * @import { LayoutFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */
import { html, raw, render } from 'fragtml'
import { navigationHref } from '../docs/navigation.js'

/**
 * The website owns its document shell; the docs layout owns the sidebar and
 * main landmark. Other pages get a simple main landmark here instead.
 * @type {LayoutFunction<{ title?: string, layout?: string, lang?: string, basePath?: string }, string | HtmlResult, string>}
 */
export default function rootLayout ({ children, vars, page, scripts, styles }) {
  const isDocs = vars.layout === 'docs'
  const content = typeof children === 'string' ? raw(children) : children
  const home = navigationHref(page.url, '/')
  const docs = navigationHref(page.url, '/docs/')
  const examples = navigationHref(page.url, '/docs/example-projects/')
  /** @param {string} path */
  const assetUrl = path => path.startsWith('/') ? `${vars.basePath ?? ''}${path}` : path
  const menuToggle = html`
    <button class="site-menu-toggle" type="button" aria-label="Open documentation menu"
      aria-controls="docs-menu" aria-expanded="false" hidden>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
        stroke-width="1.5" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
  `

  return render(html`
    <!DOCTYPE html>
    <html lang="${vars.lang ?? 'en'}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>${vars.title ? `${vars.title} | domstack` : 'domstack'}</title>
        ${styles?.map(style => html`<link rel="stylesheet" href="${assetUrl(style)}" />`)}
        ${scripts?.map(script => html`<script type="module" src="${assetUrl(script)}"></script>`)}
      </head>
      <body class="site">
        <a class="site-skip-link" href="${isDocs ? '#docs-content' : '#main-content'}">Skip to content</a>
        <header class="site-header">
          <div class="site-header-inner">
            <a class="site-brand" href="${home}" aria-label="domstack home">domstack</a>
            <nav class="site-links" aria-label="Site">
              <a href="${docs}" ${isDocs ? raw('aria-current="true"') : ''}>Docs</a>
              <a class="site-examples-link" href="${examples}">Examples</a>
              <a href="https://github.com/bcomnes/domstack">GitHub <span aria-hidden="true">↗</span></a>
            </nav>
            ${isDocs ? menuToggle : ''}
          </div>
        </header>
        <div class="site-body">
          ${isDocs ? content : html`<main class="mine-layout app-main" id="main-content" tabindex="-1">${content}</main>`}
        </div>
        <footer class="site-footer">
          <div class="site-footer-inner">
            <p><a class="site-brand" href="${home}">domstack</a></p>
            <nav class="site-links" aria-label="Footer">
              <a href="${docs}">Docs</a>
              <a href="https://www.npmjs.com/package/@domstack/static">npm</a>
              <a href="https://github.com/bcomnes/domstack">GitHub</a>
              <a href="https://github.com/bcomnes/domstack/blob/master/LICENSE">MIT license</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  `)
}
