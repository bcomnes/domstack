import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'
import type { LayoutFunction } from '@domstack/static'

import defaultRootLayout from './root.layout.ts'
import type { PageVars } from './root.layout.ts'

export interface BlogIndexVars extends PageVars {
  publishDate: string;
}

const blogIndexLayout: LayoutFunction<BlogIndexVars> = (args) => {
  const { children, ...rest } = args

  const wrappedChildren = render(html`
    <div class="blog-index">
      <h1>${rest.vars.title}</h1>
      ${typeof children === 'string'
        ? html`<div dangerouslySetInnerHTML=${{ __html: children }}></div>`
        : children
      }
    </div>
  `)

  return defaultRootLayout({ children: wrappedChildren, ...rest })
}

export default blogIndexLayout
