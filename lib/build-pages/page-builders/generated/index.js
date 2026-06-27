/**
 * @import { PageBuilderType } from '../page-writer.js'
 */

import assert from 'node:assert'

/**
 * Build a generated page from data returned by a *.pages.* file.
 * Generated pages use global/layout assets only; they do not have page-local assets.
 *
 * @template {Record<string, any>} T - The type of variables for the page
 * @template [U=any] U - The return type of the pageLayout function
 * @type {PageBuilderType<T, U>}
 */
export async function generatedBuilder ({ pageInfo }) {
  assert(pageInfo.type === 'generated', 'generated builder requires a "generated" page type')
  assert(pageInfo.generated, 'generated page requires generated metadata')

  const generated = pageInfo.generated

  return {
    vars: generated.vars ?? {},
    pageLayout: typeof generated.children === 'function'
      ? generated.children
      : () => generated.children ?? '',
  }
}
