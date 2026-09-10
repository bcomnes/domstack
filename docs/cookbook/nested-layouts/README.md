---
layout: docs
docsOrder: 131
docsParent: /docs/cookbook/
handlebars: false
---

# Compose nested layouts

[All recipes](../)

This recipe uses the [explicit `parentLayout` declaration](../../layouts/#declaring-nested-layouts) described in the layout API.
Pages select their innermost layout with `vars.layout`.
A layout can export a static `parentLayout` name to let DOMStack wrap it in another layout.

```typescript
// article.layout.ts
import { html, raw, render } from 'fragtml'
import type { LayoutFunction } from '@domstack/static/types.js'
import type { RootLayoutVars } from './root.layout.ts'

export const parentLayout = 'root'
export const vars = { showSidebar: true }

const articleLayout: LayoutFunction<RootLayoutVars, string, string> = ({ children }) => {
  return render(html`<article>${raw(children)}</article>`)
}

export default articleLayout
```

```typescript
// posts/example/page.ts
export const vars = { layout: 'article', title: 'A post' }
export default () => '<p>Hello from the post.</p>'
```

DOMStack renders `root(article(page()))`.
A root layout omits `parentLayout`; child layouts can name any discovered layout, including the bundled `root`.
Names are the same filename-derived names used by `vars.layout`, not import paths.
Missing parents, invalid parent exports, and cycles fail the build with the offending layout or chain.

All renderers receive the same resolved vars, page metadata, worker URLs, and asset lists.
Vars merge from outermost to innermost layout, followed by page vars and builder/frontmatter vars.
Layout `vars.layout` does not select a parent; only the named `parentLayout` export establishes nesting.
Async layouts are awaited at every step, and intermediate values pass through unchanged until the final result is serialized.
Each parent must accept the kind of children its immediate child returns.

## Data subscriptions in nested layouts

Each layout declares only the data it reads.
Keep focused consumer types beside their producer in `global.data.ts`:

```typescript
// global.data.ts
export type RootLayoutData = { navigation: { title: string, url: string }[] }
export type ArticleLayoutData = { recentPosts: { title: string, url: string }[] }
export type GlobalData = RootLayoutData & ArticleLayoutData
```

```typescript
// root.layout.ts
import type { DataDeps } from '@domstack/static/types.js'
import type { RootLayoutData } from './global.data.ts'

export const vars = {
  dataDeps: ['navigation'] satisfies DataDeps<RootLayoutData>,
}
```

```typescript
// article.layout.ts
import type { DataDeps } from '@domstack/static/types.js'
import type { ArticleLayoutData } from './global.data.ts'

export const parentLayout = 'root'
export const vars = {
  dataDeps: ['recentPosts'] satisfies DataDeps<ArticleLayoutData>,
}
```

These declaration snippets accompany each layout's render function.
The root receives `data.navigation`, and the article receives `data.recentPosts`.
A page using `article` rebuilds when either key changes, but it receives neither key unless it declares its own subscription.
Only put a subscription in a shared root when every descendant genuinely uses that data through the root.

## Nested layout client bundles and styles

DOMStack includes each ancestor's own style and client entry automatically.
The order is defaults → globals → outer layouts → inner layouts → page assets.
For example, a post using `article` receives `root.layout.css` before `article.layout.css`.
Do not also import the parent's layout CSS or client from the child: doing both duplicates its contents or execution.

Watch mode uses the resolved chain for source-backed and generated pages.
Changing a parent layout or one of its imported helpers rebuilds descendant pages, and changing the chain updates those relationships after a successful build.
Existing asset edits use esbuild's watcher; adding or removing a layout asset updates the affected pages' asset lists.
