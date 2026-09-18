/**
 * @import { PageBuilderType } from '../../outputs/page-writer.js'
 */
import assert from 'node:assert'

import { getMd, renderMd } from './get-md.js'
import { prepareMarkdown } from '../../source-preparation/markdown.js'

/**
 * Capture Markdown source and variables, and prepare its renderer.
 * @type {PageBuilderType<Record<string, any>, string>}
 */
export async function mdBuilder ({ pageInfo, options }) {
  assert(pageInfo.type === 'md', 'md builder requires an "md" page type')

  const markdownItSettingsPath = options?.markdownItSettingsPath || null

  const md = await (options?.getMarkdownRenderer ?? getMd)(markdownItSettingsPath)
  const prepared = options?.prepareMarkdown
    ? await options.prepareMarkdown(pageInfo)
    : await prepareMarkdown(pageInfo.pageFile.filepath)

  return {
    vars: prepared.vars,
    pageLayout: async (vars) => await renderMd(prepared.markdownContent, vars, md, markdownItSettingsPath),
  }
}
