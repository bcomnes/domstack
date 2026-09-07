import type { DataDeps, PagesFunction } from '@domstack/static/types.js'
import type { BlogIndexesPagesData, BlogPost } from './global.data.js'

type YearIndexPageVars = {
  layout: 'year-index'
  title: string
  posts: BlogPost[]
}

/**
 * Turn the yearly groups prepared by global.data.ts into normal pages.
 * The year-index layout renders the posts already assigned to each archive.
 */
export const dataDeps = ['blogIndexes'] satisfies DataDeps<BlogIndexesPagesData>

const blogIndexes: PagesFunction<
  YearIndexPageVars,
  string,
  Record<string, never>,
  BlogIndexesPagesData
> = ({ data }) => {
  const pages = []

  for (const { year, posts } of data.blogIndexes) {
    pages.push({
      outputName: `blog/${year}/index.html`,
      vars: {
        layout: 'year-index' as const,
        title: String(year),
        posts,
      },
    })
  }

  return pages
}

export default blogIndexes
