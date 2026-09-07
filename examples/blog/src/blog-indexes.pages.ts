import type { PagesFunction } from '@domstack/static/types.js'
import type { GlobalData } from './global.data.js'

type YearIndexPageVars = {
  layout: 'year-index'
  title: string
  posts: GlobalData['blogPosts']
}

/**
 * Turn the yearly groups prepared by global.data.ts into normal pages.
 * The year-index layout renders the posts already assigned to each archive.
 */
export const dataDependencies = ['blogIndexes']

const blogIndexes: PagesFunction<
  YearIndexPageVars,
  string,
  Record<string, never>,
  Pick<GlobalData, 'blogIndexes'>
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
