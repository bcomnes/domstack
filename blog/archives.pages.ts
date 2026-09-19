import type { DataDeps, PagesFunction } from '@domstack/static/types.js'
import type { BlogData } from '../site/lib/blog.ts'
import { blogIndex } from '../site/lib/blog-index.ts'

type ArchiveData = Pick<BlogData, 'blogArchives'>
export const dataDeps = ['blogArchives'] satisfies DataDeps<ArchiveData>

const archives: PagesFunction<{ layout: 'blog-index'; title: string; description: string }, string, Record<string, never>, ArchiveData> = ({ data }) =>
  data.blogArchives.map(archive => ({
    outputName: `${archive.year}/index.html`,
    vars: {
      layout: 'blog-index' as const,
      title: `${archive.year} · Blog · domstack`,
      description: `Posts from the ${archive.year} domstack blog archive.`,
    },
    children: blogIndex(archive.posts, data.blogArchives, archive.year),
  }))

export default archives
