import { readFile } from 'node:fs/promises'
import { load, YAML11_SCHEMA } from 'js-yaml'
import { extractFirstH1 } from '../page-builders/md/extract-title-from-md.js'
import { parseMdFileContents } from '../page-builders/md/parse-md.js'

/**
 * @typedef {object} PreparedMarkdown
 * @property {string} markdownContent
 * @property {Record<string, any>} vars
 */

/**
 * Prepare source only; renderers and settings belong to the current build.
 * @param {string} filepath
 * @returns {Promise<PreparedMarkdown>}
 */
export async function prepareMarkdown (filepath) {
  const fileContents = await readFile(filepath, 'utf8')
  const { frontMatterUnparsed, markdownContent } = parseMdFileContents(fileContents)
  const frontMatter = frontMatterUnparsed?.trim()
    ? /** @type {object} */ (load(frontMatterUnparsed, { schema: YAML11_SCHEMA }))
    : {}

  // Explicit frontmatter titles override inference, including null and empty values.
  const title = frontMatter != null && Object.hasOwn(frontMatter, 'title')
    ? undefined
    : extractFirstH1(markdownContent)

  return { markdownContent, vars: Object.assign({ title }, frontMatter) }
}
