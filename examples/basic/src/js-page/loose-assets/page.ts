import { html } from 'fragtml'
import type { PageForLayout } from '@domstack/static/types.js'

import sharedData from './shared-lib.ts'

const JSPage: PageForLayout<'root'> = async () => {
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
  </div>
  `
}

export default JSPage

export const vars = {
  title: 'JS Page with loose assets',
}
