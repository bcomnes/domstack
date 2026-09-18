/** @import { PageBuilderType } from '../../outputs/page-writer.js' */

import assert from 'node:assert'
import { readFile } from 'fs/promises'
import { compileHandlebars } from '../compile-handlebars.js'

/**
 * Capture HTML source once and interpolate it with current inputs on each render.
 * @type {PageBuilderType<Record<string, any>, string>}
 */
export async function htmlBuilder ({ pageInfo }) {
  assert(pageInfo.type === 'html', 'html builder requires a "html" page type')

  const fileContents = await readFile(pageInfo.pageFile.filepath, 'utf8')

  return {
    vars: {},
    pageLayout: async (vars) => {
      const template = compileHandlebars(fileContents, vars)
      return template ? template(vars) : fileContents
    },
  }
}
