/**
 * @import { PageBuilderType } from '../../outputs/page-writer.js'
 * @import { renderMd } from './get-md.js'
 */
import assert from 'node:assert'

import { createMdResolver, isDefaultMdResolver } from './create-md-resolver.js'
import { prepareMarkdown } from '../../source-preparation/markdown.js'

/**
 * Capture Markdown source and variables. Default renderer setup waits for use;
 * application settings and custom resolvers still run before source preparation.
 * @type {PageBuilderType<Record<string, any>, string>}
 */
export async function mdBuilder ({ pageInfo, options }) {
  assert(pageInfo.type === 'md', 'md builder requires an "md" page type')

  const markdownItSettingsPath = options?.markdownItSettingsPath || null

  const resolveMd = options?.getMarkdownRenderer ?? createMdResolver()
  const eager = !!markdownItSettingsPath || !isDefaultMdResolver(resolveMd)
  let md = eager ? await resolveMd(markdownItSettingsPath) : undefined
  /** @type {typeof renderMd | undefined} */
  let render = eager ? (await import('./get-md.js')).renderMd : undefined
  const prepared = options?.prepareMarkdown
    ? await options.prepareMarkdown(pageInfo)
    : await prepareMarkdown(pageInfo.pageFile.filepath)

  return {
    vars: prepared.vars,
    pageLayout: async (vars) => {
      if (!render) {
        const renderer = await resolveMd(markdownItSettingsPath)
        const module = await import('./get-md.js')
        md = renderer
        render = module.renderMd
      }
      return render(prepared.markdownContent, vars, md, markdownItSettingsPath)
    },
  }
}
