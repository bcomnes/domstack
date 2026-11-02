---
layout: docs
docsOrder: 128
docsParent: /docs/advanced/
handlebars: false
---

# Incremental global data

> [!NOTE]
> Most sites do not need incremental global data.
> Start with a regular [`global.data.ts` callback](../../data/#global-data) and consider incremental indexing when a large number of pages makes watch rebuilds slow.

An incremental index caches results for each source page so you can update affected entries instead of processing every page on every watch rebuild.
Keep the index in saved state and return the shared values your pages need, such as a navigation list.
Saved state is private to the callback; it is not exposed through `data`.

## State and changes

The callback receives four fields:

- `pages`: All current source pages, excluding generated pages.
- `previousState`: A copy of your saved state, or `undefined` when starting fresh.
  You can modify it, but must call `setState` to save your updates.
- `changes`: On `kind: 'reset'`, rebuild the index from `pages`.
  On `kind: 'delta'`, update entries for the new or affected pages in `changes.upserted` and delete the IDs in `changes.removed`.
- `setState(next)`: Take a snapshot of your index to reuse on the next build.
  DOMStack keeps that snapshot only if the current build succeeds.

Use `page.sourceId` as the index key: a read-only source-relative path such as `docs/data/README.md`, using `/` separators on every platform.
`changes.removed` contains these same IDs.

## Simple documentation index

This example caches titles and URLs for Markdown pages under `/docs/` and returns a sorted navigation list.

```typescript
// src/global.data.ts
import type { GlobalDataFunctionParams } from '@domstack/static/types.js'

type SourceVars = { title?: string }
type Entry = { title: string, url: string }
type Index = Map<string, Entry>

export default function ({
  pages, previousState, changes, setState,
}: GlobalDataFunctionParams<SourceVars, string, Index>) {
  let index: Index
  let inputs: typeof pages
  switch (changes.kind) {
    case 'reset':
      index = new Map()
      inputs = pages
      break
    case 'delta':
      index = previousState ?? new Map()
      inputs = previousState === undefined ? pages : changes.upserted
      for (const sourceId of changes.removed) index.delete(sourceId)
      break
    default:
      throw new Error('Unhandled global-data changes', { cause: changes satisfies never })
  }

  for (const page of inputs) {
    const { url, type } = page.pageInfo
    if (type !== 'md' || !url.startsWith('/docs/')) {
      index.delete(page.sourceId)
      continue
    }
    index.set(page.sourceId, { title: page.vars.title ?? url, url })
  }

  setState(index)
  return {
    docsNavigation: [...index.values()].sort((a, b) => a.url.localeCompare(b.url)),
  }
}
```

A layout subscribes with `export const vars = { dataDeps: ['docsNavigation'] }` and reads `data.docsNavigation`.
If you edit a Markdown page without changing its title or URL, the navigation stays the same, so other pages do not rebuild just because they subscribe to it.
For an example that also caches heading links, see the [documentation site's index](https://github.com/bcomnes/domstack/blob/master/site/globals/global.data.ts).

The third type argument in `GlobalDataFunctionParams<SourceVars, SourceContent, State>` describes the saved state—`Index` in this example.
For `GlobalDataFunction` and `AsyncGlobalDataFunction`, `State` is the fourth type argument, after the result, source-vars, and source-content types.
It defaults to `unknown`.
Helpers that process `changes` can use the exported `GlobalDataChanges` type.

## Usage notes

- State lasts for one watch session, not across process restarts.
  Always handle `changes.kind === 'reset'`, including after failed builds.
- Source-page edits and tracked helper changes can update individual entries.
  Changes to `global.data.*` or settings inputs reset the saved index.
- Store structured-cloneable values such as plain records, arrays, or maps—not `PageData` instances, functions, or native objects with shared mutable storage.
- A page can appear in `changes.upserted` even when its content is unchanged.
  Replace its cached entry, or delete it if the page no longer belongs in your index.
- Relative static imports within the watched source tree are tracked, including imported JSON.
  Restart watch mode after changing files read with `fs.readFile()`, environment variables, or other inputs outside page dependency tracking.
- Static re-exports (`export … from`) are not followed by dependency tracking ([#328](https://github.com/bcomnes/domstack/issues/328)).
  Use an explicit import followed by a local export, or restart watch mode after those dependencies change.
