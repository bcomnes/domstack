import { html } from 'fragtml'
import type { PagesForLayout } from '@domstack/static/types.js'
import type globalVars from './global.vars.ts'

type GuideVars = {
  title: string
  topics: string[]
}

type GuidePages = PagesForLayout<
  'child',
  GuideVars,
  Awaited<ReturnType<typeof globalVars>>,
  Record<string, never>,
  Record<string, never>
>

// The factory sees globals, not the defaults belonging to each generated page.
const guides: GuidePages = ({ vars: globals }) => [
  {
    outputName: 'guides/layout-defaults/index.html',
    vars: {
      layout: 'child',
      title: `${globals.siteName}: inherited defaults`,
      topics: ['Global vars', 'Layout defaults'],
    },
    children: async ({ vars, page }) => html`
      <section>
        <h2>Generated page with inferred vars</h2>
        <p>${vars.siteName} · ${vars.locale} · ${vars.theme} theme</p>
        <p>${vars.readingMinutes} min read · ${vars.badge.label}</p>
        <p>Root footer: ${vars.footer.label}</p>
        <ul>${vars.topics.map(topic => html`<li>${topic}</li>`)}</ul>
        <p>Generated URL: ${page.url}</p>
      </section>
    `,
  },
  {
    outputName: 'guides/static-content/index.html',
    vars: {
      layout: 'child',
      title: 'Generated static content',
      topics: ['Static children'],
    },
    children: '<p>Static children use the same checked layout contract.</p>',
  },
]

export default guides
