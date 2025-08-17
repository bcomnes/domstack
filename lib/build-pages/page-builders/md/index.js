/**
 * @import markdownIt from 'markdown-it'
 * @import { PageBuilderType } from '../page-writer.js'
 */
import assert from 'node:assert'
import { readFile } from 'fs/promises'
import yaml from 'js-yaml'
import { getMd, renderMd } from './get-md.js'
import { extractFirstH1 } from './extract-title-from-md.js'

/** @type {markdownIt | null} */
let md = null

/**
 * Build all of the bundles using esbuild.
 * @template {Record<string, any>} T - The type of variables for the page
 * @type {PageBuilderType<T, string>}
 */
export async function mdBuilder ({ pageInfo, options }) {
  assert(pageInfo.type === 'md', 'md builder requires an "md" page type')

  const markdownItSettingsPath = options?.markdownItSettingsPath || null

  if (!md) md = await getMd(markdownItSettingsPath)
  const fileContents = await readFile(pageInfo.pageFile.filepath, 'utf8')

  /** @type {object} */
  let frontMatter
  /** @type {string} */
  let mdUnparsed
  if (fileContents.trim().startsWith('---')) {
    const [/* _ */, frontMatterUnparsed, ...mdParts] = fileContents.split('---')
    mdUnparsed = mdParts.join('---')
    // @ts-ignore
    frontMatter = yaml.load(frontMatterUnparsed ?? '')
  } else {
    frontMatter = {}
    mdUnparsed = fileContents
  }

  // Extract title from first H1 using markdown-it's token API
  const title = extractFirstH1(mdUnparsed)

  return {
    vars: Object.assign({ title }, frontMatter),
    pageLayout: async (vars) => await renderMd(mdUnparsed, vars, md, markdownItSettingsPath),
  }
}
