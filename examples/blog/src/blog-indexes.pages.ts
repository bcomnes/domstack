import type { PagesFunction } from '@domstack/static/types.js'
import type { GlobalData } from './global.data.js'

type YearIndexPageVars = {
  layout: 'year-index'
  title: string
}

function publishYear (value: unknown): number | undefined {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined

  const date = new Date(value.valueOf())
  return Number.isNaN(date.valueOf()) ? undefined : date.getUTCFullYear()
}

/**
 * Generate one yearly archive for every year represented by a blog post.
 * The year-index layout finds and renders the posts inside each archive folder.
 */
const blogIndexes: PagesFunction<YearIndexPageVars, string, GlobalData> = ({ vars }) => {
  const years = new Set<number>()
  const indexes = []

  for (const post of vars.blogPosts) {
    const year = publishYear(post.publishDate)
    if (year === undefined || years.has(year)) continue

    years.add(year)
    indexes.push({
      outputName: `blog/${year}/index.html`,
      vars: {
        layout: 'year-index' as const,
        title: String(year),
      },
      children: '',
    })
  }

  indexes.sort((a, b) => b.outputName.localeCompare(a.outputName))
  return indexes
}

export default blogIndexes
