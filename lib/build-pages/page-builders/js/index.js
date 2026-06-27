/**
 * @import { PageBuilderType } from '../page-writer.js'
 */

import assert from 'node:assert'

/**
 * Build all of the bundles using esbuild.
 * @template {Record<string, any>} T - The type of variables for the page
 * @template [U=any] U - The return type of the pageLayout function
 * @type {PageBuilderType<T, U>}
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
