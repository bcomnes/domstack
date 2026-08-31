/**
 * @import { TemplateFunction } from '#types'
 */

/** @type {TemplateFunction<{ blogPosts: unknown[], sourcePageCount: number }>} */
export default async function summaryTemplate ({ pages, vars }) {
  return {
    outputName: 'summary.json',
    content: JSON.stringify({
      sourcePageCount: vars.sourcePageCount,
      blogPostCount: vars.blogPosts.length,
      generatedPagesInTemplate: pages.filter(page => Boolean(page.pageInfo.generated)).length,
    }, null, 2),
  }
}
