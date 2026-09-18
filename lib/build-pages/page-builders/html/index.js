/**
 * @import { PageBuilderType } from '../../outputs/page-writer.js'
 * @import HandlebarsType from 'handlebars'
 */

import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFile } from 'fs/promises'

/**
 * Build all of the bundles using esbuild.
 * @type {PageBuilderType<Record<string, any>, string>}
 */
export async function htmlBuilder ({ pageInfo }) {
  assert(pageInfo.type === 'html', 'html builder requires a "html" page type')

  const fileContents = await readFile(pageInfo.pageFile.filepath, 'utf8')

  return {
    vars: {},
    pageLayout: async (vars) => {
      if (vars?.vars?.['handlebars']) {
        /** @type {typeof HandlebarsType} */
        const Handlebars = createRequire(import.meta.url)('handlebars')
        const template = Handlebars.compile(fileContents)
        return template(vars)
      } else {
        return fileContents
      }
    },
  }
}
