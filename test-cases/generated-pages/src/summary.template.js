/**
 * @import { TemplateFunction } from '#types'
 */

/** @type {TemplateFunction<{ generatedPageCount: number }>} */
export default async function summaryTemplate ({ pages, vars }) {
  return {
    outputName: 'summary.json',
    content: JSON.stringify({
      generatedPageCount: vars.generatedPageCount,
      generatedPagesInTemplate: pages.filter(page => Boolean(page.pageInfo.generated)).length,
    }, null, 2),
  }
}
