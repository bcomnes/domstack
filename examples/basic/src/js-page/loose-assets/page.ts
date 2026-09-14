import { html } from 'fragtml'
import type { PageForLayout, PageOutputsForRenderer, ValidatePageVars } from '@domstack/static/types.js'
import type globalVars from '../../global.vars.ts'

import sharedData from './shared-lib.ts'

type AssetPage = PageForLayout<
  'root',
  typeof vars,
  Record<string, never>,
  Awaited<ReturnType<typeof globalVars>>
>

const JSPage: AssetPage = async ({ vars }) => {
  return html`
  <div>
    <p>
      You can keep loose assets basically anywhere in the <pre>src</pre> directory.
      If they are css or js files, they get included into the built website into any of the
      client bundle they are imported into.
    </p>
    <p>
      This page demonstrates that with the shared-lib.js and local-import.css files
      that get imported into the page.js, client.js and style.css files for this page.
    </p>
    <p>${sharedData.shared}</p>
    <section>
      <h2>Inferred root-layout variables</h2>
      <p>${vars.siteName} · ${vars.locale} · ${vars.theme} theme</p>
      <p>Root footer default: ${vars.footer.label}</p>
      <h3>Page-only asset metadata</h3>
      <ul>
        ${vars.assets.map(asset => html`<li>${asset.label}: ${asset.kind}</li>`)}
      </ul>
      <p><a href="./assets.json">Download asset metadata as JSON</a></p>
    </section>
  </div>
  `
}

export default JSPage

export const pageOutputs: PageOutputsForRenderer<AssetPage> = ({ page, vars }) => ({
  outputName: './assets.json',
  content: JSON.stringify({
    title: vars.title,
    siteName: vars.siteName,
    locale: vars.locale,
    theme: vars.theme,
    assets: vars.assets,
    url: page.url,
  }, null, 2),
})

const pageVars = {
  title: 'JS Page with loose assets',
  assets: [
    { label: 'Shared data', kind: 'module' as const },
    { label: 'Local styles', kind: 'stylesheet' as const },
  ],
}

export const vars = pageVars satisfies ValidatePageVars<
  'root',
  typeof pageVars,
  Awaited<ReturnType<typeof globalVars>>
>
