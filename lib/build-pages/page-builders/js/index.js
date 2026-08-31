/**
 * @import { PageInfo } from '../../../identify-pages.js'
 * @import { PageBuilderResult } from '../page-writer.js'
 */

import assert from 'node:assert'

/**
 * Resolve a JavaScript page module.
 * @template {Record<string, any>} T - The type of variables for the page
 * @template [U=any] U - The return type of the page function
 * @param {object} params
 * @param {PageInfo} params.pageInfo
 * @returns {Promise<PageBuilderResult<T, U>>}
 */
export async function jsBuilder ({ pageInfo }) {
  assert(pageInfo.type === 'js', 'js page builder requires "js" page type')

  if (pageInfo.generated) {
    const { vars, children } = pageInfo.generated
    return {
      vars: /** @type {Partial<T>} */ (vars ?? {}),
      pageLayout: typeof children === 'function'
        ? children
        : () => children ?? '',
    }
  }

  const { default: pageLayout, vars } = await import(pageInfo.pageFile.filepath)

  assert(pageLayout, 'js pages must export a page layout default export')
  assert(typeof pageLayout === 'function', 'js pages pageLayout must be a function')

  return { vars, pageLayout }
}
