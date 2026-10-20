import type { LayoutFunction } from '@domstack/static/types.js'
import { html, raw, render } from 'fragtml'
import type { SiteData } from '../components/slide.ts'

export const vars = { defaultStyle: false, dataDeps: ['slideNavigation'] }

const symbols = [
  html`<circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18" />`,
  html`<circle cx="12" cy="12" r="10" /><path d="m10 7 7 5-7 5Z" />`,
  html`<path d="M12 2 22 20H2Z" /><path d="M12 9v6" />`,
  html`<rect x="3" y="3" width="18" height="18" /><path d="m3 3 18 18M21 3 3 21" />`,
  html`<path d="M4 5h16M12 5v15M7 20h10M4 5v4M20 5v4" />`,
  html`<path d="M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v6H3zM14 15h7v6h-7z" />`,
  html`<rect x="2" y="4" width="20" height="16" /><path d="m2 4 10 9L22 4" />`,
  html`<path d="M12 12C8 4 2 5 2 12s6 8 10 0 10-7 10 0-6 8-10 0Z" />`,
]

type RootVars = { title: string; view?: 'stack' | 'slide' }
const rootLayout: LayoutFunction<RootVars, string, string, Pick<SiteData, 'slideNavigation'>> = ({ vars, children, scripts, styles, data }) => render(html`
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="description" content="Cargo / Like — an immersive experiment in typography, images, and movement." />
      <meta name="theme-color" content="#080808" />
      <title>${vars.title} — Cargo / Like</title>
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />

      ${styles?.map(style => html`<link rel="stylesheet" href="${style}" />`)}
      ${scripts?.map(script => html`<script type="module" src="${script}"></script>`)}
    </head>
    <body data-view="${vars.view ?? 'stack'}">
      <a class="skip-link" href="#main">Skip to content</a>
      <div class="scroll-progress" aria-hidden="true"></div>
      <header class="site-header">
        <a class="brand" href="/" aria-label="Cargo / Like home">Cargo / Like<span class="brand-dot" aria-hidden="true"><svg class="asterisk-icon" viewBox="0 0 100 100" focusable="false"><path d="M50 8v84M8 50h84M20 20l60 60M20 80l60-60" fill="none" stroke="currentColor" stroke-width="10" /></svg></span></a>
        <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="chapter-nav">Chapters <span aria-hidden="true">+</span></button>
        <nav id="chapter-nav" class="chapter-nav" aria-label="Chapters">
          ${data.slideNavigation.map((slide, i) => html`<a href="/#${slide.id}" aria-label="${slide.label}"><span class="nav-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">${symbols[i % symbols.length]}</svg></span><span class="nav-label">${slide.label}</span><span class="nav-index" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span></a>`)}
        </nav>
      </header>
      <main id="main" tabindex="-1">${raw(children)}</main>
      <footer class="site-footer"><span>Cargo / Like — an independent web experiment</span><a href="/#opening">Return to the beginning ↑</a><span>Edition 001 · Lorem ipsum</span><span class="powered-by">Powered by <a class="domstack-wordmark" href="https://domstack.net">domstack</a></span></footer>
    </body>
  </html>
`)

export default rootLayout
