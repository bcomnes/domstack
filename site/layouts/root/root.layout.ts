import { html, raw, render } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'
import type { LayoutFunction } from '@domstack/static/types.js'
import { navigationHref } from '../docs/navigation.js'

export interface RootVars {
  title?: string
  description?: string
  layout?: string
  lang?: string
  basePath?: string
  siteUrl?: string
  ahrefsAnalyticsKey?: string
  [key: string]: unknown
}

function year (): number {
  return new Date().getFullYear()
}

function editUrl (sourceRelname: string): string {
  return 'https://github.com/bcomnes/domstack/edit/master/' + sourceRelname.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
}

const rootLayout: LayoutFunction<RootVars, string | HtmlResult, string> = ({ children, vars, page, scripts, styles }) => {
  const isDocs = vars.layout === 'docs'
  const ownsMain = isDocs || vars.layout === 'blog' || vars.layout === 'blog-index'
  const content = typeof children === 'string' ? raw(children) : children
  const home = navigationHref(page.url, '/')
  const docs = navigationHref(page.url, '/docs/')
  const examples = navigationHref(page.url, '/docs/example-projects/')
  const blog = navigationHref(page.url, '/blog/')
  const assetUrl = (path: string): string => path.startsWith('/') ? `${vars.basePath ?? ''}${path}` : path
  const pageUrl = vars.siteUrl ? new URL(assetUrl(page.url), vars.siteUrl).href : undefined
  const title = vars.title ? `${vars.title} | domstack` : 'domstack'
  const description = vars.description || 'DOMStack builds static websites and multi-page apps from HTML, Markdown, CSS, and JavaScript.'
  const editSource = page.generated?.pagesFile.pagesFile.relname ?? page.pageFile?.relname ?? 'README.md'

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
        <title>${title}</title>
        <link rel="icon" href="${assetUrl('/favicon.ico')}" sizes="16x16 32x32 48x48" />
        <link rel="icon" type="image/png" sizes="32x32" href="${assetUrl('/site/icons/favicon-light.png')}" media="(prefers-color-scheme: light)" />
        <link rel="icon" type="image/png" sizes="32x32" href="${assetUrl('/site/icons/favicon-dark.png')}" media="(prefers-color-scheme: dark)" />
        ${[152, 167, 180].map(size => html`<link rel="apple-touch-icon" sizes="${size}x${size}" href="${assetUrl(`/site/icons/apple-touch-icon-${size}.png`)}" />`)}
        <meta property="og:site_name" content="DOMStack" />
        <meta property="og:title" content="${title}" />
        <meta property="og:type" content="${vars.layout === 'blog' ? 'article' : 'website'}" />
        <meta property="og:description" content="${description}" />
        ${vars.siteUrl
? html`
          <link rel="canonical" href="${pageUrl}" />
          <meta property="og:url" content="${pageUrl}" />
          <meta property="og:image" content="${new URL(assetUrl('/site/logos/domstack-bosch-penwork-og.jpg'), vars.siteUrl).href}" />
          <meta property="og:image:type" content="image/jpeg" />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:alt" content="A heron and two beetles hold a parchment banner with tiny ink-drawn creatures woven through the domstack lettering." />
          <meta name="twitter:card" content="summary_large_image" />
        `
: null}
        <link rel="alternate" type="application/feed+json" title="DOMStack Blog — JSON Feed" href="${assetUrl('/feed.json')}" />
        <link rel="alternate" type="application/atom+xml" title="DOMStack Blog — Atom Feed" href="${assetUrl('/feed.xml')}" />
        ${vars.ahrefsAnalyticsKey ? html`<script src="https://analytics.ahrefs.com/analytics.js" data-key="${vars.ahrefsAnalyticsKey}" async></script>` : null}
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
              <a href="${blog}" ${page.url.startsWith('/blog/') ? raw('aria-current="true"') : ''}>Blog</a>
              <a class="site-examples-link" href="${examples}">Examples</a>
              <a href="https://github.com/bcomnes/domstack">GitHub</a>
            </nav>
            ${isDocs ? menuToggle : ''}
          </div>
        </header>
        <div class="site-body">
          ${ownsMain ? content : html`<main class="mine-layout app-main" id="main-content" tabindex="-1">${content}</main>`}
        </div>
        <footer class="site-footer">
          <div class="site-footer-inner">
            <p class="site-copyright"><a class="site-brand" href="${home}">domstack</a> © ${year()}</p>
            <nav class="site-links" aria-label="Footer">
              <a href="${docs}">Docs</a>
              <a href="${blog}">Blog</a>
              <a href="${navigationHref(page.url, '/logos/')}">Logos</a>
              <a href="${assetUrl('/feed.json')}">JSON Feed</a>
              <a href="https://www.npmjs.com/package/@domstack/static">npm</a>
              <a href="https://github.com/bcomnes/domstack">GitHub</a>
              <a href="https://github.com/bcomnes/domstack/blob/master/LICENSE">MIT license</a>
              <a class="page-edit" href="${editUrl(editSource)}">Edit this page</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  `)
}

export default rootLayout
