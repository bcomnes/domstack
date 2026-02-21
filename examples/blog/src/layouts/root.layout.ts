import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'
import type { LayoutFunction } from '@domstack/static'
import type { SiteVars } from '../global.vars.js'
import type { GlobalData } from '../global.data.js'

export type RootVars = SiteVars & GlobalData & {
  title?: string
}

const rootLayout: LayoutFunction<RootVars> = ({
  vars: { title, siteName, homePageUrl },
  scripts,
  styles,
  children,
}) => {
  const pageTitle = title ? `${title} | ${siteName}` : siteName

  return /* html */`<!DOCTYPE html>
<html lang="en">
${render(html`
  <head>
    <meta charset="utf-8" />
    <title>${pageTitle}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${styles?.map(s => html`<link rel="stylesheet" href="${s}" />`)}
    ${scripts?.map(s => html`<script type="module" src="${s}"></script>`)}
    <link rel="alternate" type="application/json" href="/feeds/feed.json" title="${siteName}" />
    <link rel="alternate" type="application/atom+xml" href="/feeds/feed.xml" title="${siteName}" />
  </head>
`)}
${render(html`
  <body class="safe-area-inset">
    <header class="site-header">
      <div class="mine-layout site-header-inner">
        <a href="${homePageUrl ?? '/'}" class="site-title">${siteName}</a>
        <nav>
          <ul class="site-nav">
            <li><a href="/blog/">Blog</a></li>
            <li><a href="/about/">About</a></li>
            <li><a href="/feeds/feed.json">Feed</a></li>
            <li><button onclick="toggleTheme()" aria-label="Toggle theme">◑</button></li>
          </ul>
        </nav>
      </div>
    </header>
    <main class="mine-layout">
      ${typeof children === 'string'
        ? html`<div dangerouslySetInnerHTML=${{ __html: children }} />`
        : children
      }
    </main>
    <footer class="site-footer">
      <div class="mine-layout">
        <p>Built with <a href="https://github.com/bcomnes/domstack">domstack</a>.</p>
      </div>
    </footer>
  </body>
`)}
</html>`
}

export default rootLayout
