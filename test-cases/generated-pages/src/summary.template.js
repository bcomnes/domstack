/**
 * @import { AsyncTemplateFunction } from '#types'
 */

export const dataDeps = ['blogPosts', 'sourcePageCount']

/** @type {AsyncTemplateFunction<Record<string, any>, { blogPosts: unknown[], sourcePageCount: number }>} */
export default async function summaryTemplate ({ data }) {
  return {
    outputName: 'summary.json',
    content: JSON.stringify({
      sourcePageCount: data.sourcePageCount,
      blogPostCount: data.blogPosts.length,
    }, null, 2),
  }
}
