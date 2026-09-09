import type { GlobalDataFunctionParams } from './types.ts'
import { collectDocsNavigation } from './layouts/docs/navigation.js'

// Only the layout subscribes to this data. Source Markdown can therefore be
// rendered here without depending on the navigation it is helping to produce.
export default async function ({ pages }: GlobalDataFunctionParams) {
  return { docsNavigation: await collectDocsNavigation(pages) }
}
