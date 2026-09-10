import type { GlobalDataFunctionParams } from '../../types.ts'
import { render } from 'fragtml'
import { collectDocsNavigation, docsIndex } from '../layouts/docs/navigation.js'

// The collector excludes the index, whose Markdown consumes docsIndexHtml.
// Other source pages are rendered without their data-subscribing layouts.
export default async function ({ pages }: GlobalDataFunctionParams) {
  const docsNavigation = await collectDocsNavigation(pages)
  return { docsNavigation, docsIndexHtml: render(docsIndex(docsNavigation)) }
}
