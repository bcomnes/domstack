import type { PagesFunction } from '@domstack/static/types.js'

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
const blogIndexes: PagesFunction<YearIndexPageVars> = ({ pages }) => {
  const years = new Set<number>()

  for (const page of pages) {
    if (page.vars.layout !== 'post') continue

    const year = publishYear(page.vars.publishDate)
    if (year !== undefined) years.add(year)
  }

  return Array.from(years)
    .sort((a, b) => b - a)
    .map(year => ({
      outputName: `blog/${year}/index.html`,
      vars: {
        layout: 'year-index',
        title: String(year),
      },
      children: '',
    }))
}

export default blogIndexes
