/**
 * @import { PageFunction, PagesFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 */

import { html } from 'fragtml'

/** @type {PageFunction<{ sawGenerated: boolean, concreteCount: number }, HtmlResult>} */
const renderConcreteOnlyPage = ({ vars }) => html`
  <p id="saw-generated">${String(vars.sawGenerated)}</p>
  <p id="concrete-count">${vars.concreteCount}</p>
`

/** @type {PagesFunction} */
export default function concreteOnlyPages ({ pages }) {
  return {
    outputName: 'generated-introspection/index.html',
    vars: {
      layout: 'root',
      title: 'Generated introspection',
      sawGenerated: pages.some(page => Boolean(page.pageInfo.generated)),
      concreteCount: pages.length,
    },
    children: renderConcreteOnlyPage,
  }
}
