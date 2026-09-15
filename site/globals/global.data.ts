import type { GlobalDataFunctionParams } from '../../types.ts'
import type { DocsNavigationIndex, DocsPageVars } from '../layouts/docs/navigation.js'
import { render } from 'fragtml'
import { readDocsNavigationPage, projectDocsNavigation, docsIndex } from '../layouts/docs/navigation.js'

export default async function ({ pages, previousState, changes, setState }: GlobalDataFunctionParams<DocsPageVars, string, DocsNavigationIndex>) {
  const reset = changes.kind === 'reset' || previousState === undefined
  const index: DocsNavigationIndex = reset ? new Map() : new Map(previousState)
  if (changes.kind === 'delta') {
    for (const sourceId of changes.removed) index.delete(sourceId)
  }
  const inputs = changes.kind === 'delta' && !reset ? changes.upserted : pages
  await Promise.all(inputs.map(async page => {
    const sourceId = page.sourceId
    // Excludes the data-dependent index and renders docs without their layouts.
    const record = await readDocsNavigationPage(page)
    if (record) index.set(sourceId, record)
    else index.delete(sourceId)
  }))

  const docsNavigation = projectDocsNavigation(index.values())
  const docsIndexHtml = render(docsIndex(docsNavigation))
  setState(index)
  return { docsNavigation, docsIndexHtml }
}
