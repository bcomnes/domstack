---
layout: post
title: "Layouts All the Way Down"
publishDate: "2024-07-04T09:00:00.000Z"
description: "How domstack's nested layout system works and why it keeps things simple."
tags:
  - domstack
  - layouts
---

# Layouts All the Way Down

Domstack layouts are functions with an explicit parent declaration.
The `post` layout receives `children` (the rendered page content) and returns its article markup.
It exports `parentLayout = 'root'` so Domstack adds the full HTML shell around that result.
Here is a simplified `post.layout.ts`:

```ts
import { html, raw, render } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'
import type { LayoutFunction } from '@domstack/static/types.js'
import type { RootVars } from './root.layout.ts'

export const parentLayout = 'root'

const postLayout: LayoutFunction<RootVars, string | HtmlResult, string> = ({ children, vars }) => {
  return render(html`
    <article class="h-entry">
      <h1>${vars.title}</h1>
      <div class="e-content">
        ${typeof children === 'string' ? raw(children) : children}
      </div>
    </article>
  `)
}

export default postLayout
```

The page still selects its innermost layout with `layout: post` in frontmatter.
Domstack resolves the chain and renders `root(post(page()))`, with each layout running once.
Each parent can declare another parent; a layout without `parentLayout` ends the chain.
Do not also import and call the parent render function when declaring `parentLayout`, or the parent will render twice.

Manual function composition remains supported, but `parentLayout` lets Domstack manage ancestor defaults, assets, and rebuild dependencies automatically.

## Styles follow the declared chain

`post.layout.css` contains only the post layout's styles; it does not need to import `root.layout.css`.
Domstack includes the styles and client entry points for every layout in the resolved chain, ordered from the outermost parent to the innermost child, between global and page assets.
Changing an ancestor layout or one of its statically imported helpers rebuilds the pages that use that chain.

## The `vars` merge order

```
{ ...globalVars, ...globalDataVars, ...rootLayoutVars, ...postLayoutVars, ...pageVars, ...builderVars }
```

Layout defaults merge from the outermost parent to the innermost child.
Page vars override those defaults, and builder vars, including Markdown frontmatter, take precedence last.
`global.data.ts` output is merged into vars before layout defaults.
