import type { MarkdownIt } from 'markdown-it'
import { full as emoji } from 'markdown-it-emoji'
import subscript from 'markdown-it-sub'
import superscript from 'markdown-it-sup'
import definitionList from 'markdown-it-deflist'
import insertedText from 'markdown-it-ins'
import markedText from 'markdown-it-mark'
import abbreviation from 'markdown-it-abbr'
import taskLists from 'markdown-it-task-lists'
import tableOfContents from 'markdown-it-table-of-contents'
import highlightjs from 'markdown-it-highlightjs'

export function checkPluginTypes (md: MarkdownIt) {
  for (const plugin of [emoji, subscript, superscript, definitionList, insertedText, markedText, abbreviation]) {
    md.use(plugin)
    // @ts-expect-error Plugins require a MarkdownIt instance, not an arbitrary object.
    plugin({})
  }

  taskLists(md, { enabled: true, label: true, labelAfter: false })
  tableOfContents(md, { includeLevel: [1, 2, 3], slugify: (text, token) => text + token.content })
  highlightjs(md, { auto: false, code: true })
  const auto: boolean = highlightjs.defaults.auto

  // @ts-expect-error Checkbox options are booleans.
  taskLists(md, { enabled: 'yes' })
  // @ts-expect-error Heading levels are numbers.
  tableOfContents(md, { includeLevel: ['1'] })
  // @ts-expect-error Preserve the upstream highlighting option types.
  highlightjs(md, { auto: 'no' })

  return auto
}
