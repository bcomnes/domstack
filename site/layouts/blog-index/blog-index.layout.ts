import { html, raw, render } from 'fragtml'
import type { LayoutFunction } from '@domstack/static/types.js'

export interface BlogIndexVars {
  layout: 'blog-index'
  title?: string
  description?: string
  [key: string]: unknown
}

export const parentLayout = 'root' as const

const blogIndexLayout: LayoutFunction<BlogIndexVars, string, string> = ({ children }) => render(html`
  <main class="blog-main" id="main-content">
    <div class="blog-column">${raw(children)}</div>
  </main>
`)

export default blogIndexLayout

declare module '@domstack/static/types.js' {
  interface LayoutRegistry {
    'blog-index': {
      parentLayout: typeof parentLayout
      render: typeof blogIndexLayout
    }
  }
}
