/**
 * @import { PageFunction, PagesFunction } from '#types'
 * @import { HtmlResult } from 'fragtml/types.js'
 * @typedef {{ layout: string, title: string, sawGenerated: boolean, concreteCount: number }} ConcreteOnlyVars
 */

import { html } from 'fragtml'

/** @type {PageFunction<ConcreteOnlyVars, HtmlResult>} */
const renderConcreteOnlyPage = ({ vars }) => html`
  <p id="saw-generated">${String(vars.sawGenerated)}</p>
  <p id="concrete-count">${vars.concreteCount}</p>
`

export const dataDependencies = ['sourcePageCount']

/** @type {PagesFunction<ConcreteOnlyVars, HtmlResult, Record<string, any>, { sourcePageCount: number }>} */
export default function concreteOnlyPages ({ data }) {
  return {
    outputName: 'generated-introspection/index.html',
    vars: {
      layout: 'root',
      title: 'Generated introspection',
      sawGenerated: false,
      concreteCount: data.sourcePageCount,
    },
    children: renderConcreteOnlyPage,
  }
}
