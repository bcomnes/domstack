import type { DataDeps, PageFunction } from '@domstack/static/types.js'
import type { BlogData } from '../site/lib/blog.ts'
import { blogIndex } from '../site/lib/blog-index.ts'

export const vars = {
  layout: 'blog-index',
  title: 'Blog · domstack',
  dataDeps: ['blogPosts', 'blogArchives'] satisfies DataDeps<Pick<BlogData, 'blogPosts' | 'blogArchives'>>,
}

const page: PageFunction<typeof vars, string, Pick<BlogData, 'blogPosts' | 'blogArchives'>> = ({ data }) => blogIndex(data.blogPosts, data.blogArchives)
export default page
