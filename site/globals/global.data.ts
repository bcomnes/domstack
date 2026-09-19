import type { GlobalDataFunctionParams } from '../../types.ts'
import type { DocsNavigationIndex, DocsPageVars } from '../layouts/docs/navigation.js'
import { projectBlog, readBlogPost, type BlogData } from '../lib/blog.ts'
import { cpus } from 'node:os'
import pMap from 'p-map'
import { render } from 'fragtml'
import { readDocsNavigationPage, projectDocsNavigation, docsIndex } from '../layouts/docs/navigation.js'

const MAX_CONCURRENCY = Math.min(cpus().length, 24)

type SourcePageVars = DocsPageVars & { layout?: string }

export default async function ({ pages, previousState, changes, setState }: GlobalDataFunctionParams<SourcePageVars, string, DocsNavigationIndex>): Promise<{ docsNavigation: ReturnType<typeof projectDocsNavigation>; docsIndexHtml: string } & BlogData> {
  let index: DocsNavigationIndex
  let inputs: typeof pages
  switch (changes.kind) {
    case 'reset':
      index = new Map()
      inputs = pages
      break
    case 'delta':
      index = previousState ?? new Map()
      inputs = previousState === undefined ? pages : changes.upserted
      for (const sourceId of changes.removed) index.delete(sourceId)
      break
    default:
      throw new Error('Unhandled global-data changes', { cause: changes satisfies never })
  }
  await pMap(inputs, async page => {
    const sourceId = page.sourceId
    // Excludes the data-dependent index and renders docs without their layouts.
    const record = await readDocsNavigationPage(page)
    if (record) index.set(sourceId, record)
    else index.delete(sourceId)
  }, { concurrency: MAX_CONCURRENCY })

  const docsNavigation = projectDocsNavigation(index.values())
  const docsIndexHtml = render(docsIndex(docsNavigation))
  const blogPosts = await pMap(pages.filter(page => page.vars.layout === 'blog'), readBlogPost, { concurrency: MAX_CONCURRENCY })
  const blog = projectBlog(blogPosts)
  setState(index)
  return { docsNavigation, docsIndexHtml, ...blog }
}
