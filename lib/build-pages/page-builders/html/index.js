/**
 * @import { PageBuilderType } from '../page-writer.js'
 */

import assert from 'node:assert'
import { readFile } from 'fs/promises'
import Handlebars from 'handlebars'

/**
 * Build all of the bundles using esbuild.
 * @template {Record<string, any>} T - The type of variables for the page
 * @type {PageBuilderType<T, string>}
 */
export async function htmlBuilder ({ pageInfo }) {
  assert(pageInfo.type === 'html', 'html builder requires a "html" page type')

  const fileContents = await readFile(pageInfo.pageFile.filepath, 'utf8')

  return {
    vars: {},
    pageLayout: async (vars) => {
      // @ts-ignore
      if (vars?.vars?.handlebars) {
        const template = Handlebars.compile(fileContents)
        return template(vars)
      } else {
        return fileContents
      }
    },
  }
}
