# Global Data Pipeline

## Status: Implemented ✅

All core features implemented. Watch mode integration (decision tree entry for `global.data.*`)
is deferred to the progressive-rebuild work.

---

## Problem with postVars

`postVars` is a named export from a `page.vars.*` file that receives the full `pages` array
at render time. It was designed to let pages aggregate data from other pages (blog indexes,
RSS feeds, etc.) but has several problems:

- **Implicit**: any page.vars file might export postVars — there's no way to know without
  importing the file. The main process discovers which pages use postVars only *after* a
  full build completes, by reading the `postVarsPagePaths` array returned by the worker.
- **Coupled to page rendering**: data aggregation is entangled with page output, making
  both harder to reason about.
- **Mis-scoped**: a blog index page shouldn't need a special callback just to list its
  sibling pages — that's a data pipeline concern, not a page concern.
- **Watch mode contagion is blunt**: because postVars pages aggregate other pages' data,
  whenever any page file or vars file changes the main process must re-render the changed
  page *plus* every page that was detected as a postVars consumer last time.

## Replacement: `global.data.js`

A single optional file anywhere in the `src` tree: `global.data.js` (or `.ts`). Like all global assets, the first one found wins and duplicates produce a warning.

It runs once per build, inside the worker, after all pages are initialized but before
rendering begins. It receives the fully resolved `PageData[]` array and returns an object
that is stamped onto every page's vars — available to every page, layout, and template.

### API

```ts
// global.data.ts
import type { AsyncGlobalDataFunction } from 'domstack'

export default (async ({ pages }) => {
  const blogPosts = pages
    .filter(p => p.vars?.layout === 'blog' && p.vars?.publishDate)
    .sort((a, b) => new Date(b.vars.publishDate) - new Date(a.vars.publishDate))

  return {
    blogPosts,
    recentPosts: blogPosts.slice(0, 5),
  }
}) satisfies AsyncGlobalDataFunction
```

The returned object is stamped onto every page's `globalDataVars` field, which the `vars`
getter merges in after `globalVars` but before `pageVars`:

```
vars = { ...globalVars, ...globalDataVars, ...pageVars, ...builderVars }
```

### Why resolved PageData, not raw PageInfo

`global.data.js` runs after `pageData.init()` for all pages. This means it receives
fully resolved `PageData[]` — every page has `.vars` (merged global + page + builder
vars), `.pageInfo`, `.styles`, `.scripts`, etc. This is strictly richer than raw
`PageInfo[]`, and avoids needing a separate `parseFrontmatter()` step in `identifyPages`.

The tradeoff is an explicit coordination barrier: all pages must finish `init()` before
`global.data.js` can run, and all pages must have `globalDataVars` stamped before
rendering begins. This is inherent to the design — there's no way to pipeline init→render
per-page while also running `global.data.js` in between without making `vars` async.

### Migration: postVars → global.data.js

**Before** (`blog/page.vars.js`):
```js
export default {
  layout: 'blog',
  title: 'Blog',
}

export async function postVars ({ pages }) {
  const posts = pages
    .filter(p => p.pageInfo.pageFile.relname.startsWith('blog/'))
    .sort((a, b) => new Date(b.vars.date) - new Date(a.vars.date))

  return { posts }
}
```

**After** — remove postVars from `blog/page.vars.js`:
```js
export default {
  layout: 'blog',
  title: 'Blog',
}
```

Add `global.data.js` anywhere in the src tree:
```js
export default async function ({ pages }) {
  const blogPosts = pages
    .filter(p => p.vars?.layout === 'blog')
    .sort((a, b) => new Date(b.vars.date) - new Date(a.vars.date))

  return { blogPosts }
}
```

The blog index page's layout or page function reads `vars.blogPosts` directly.

## Build Pipeline Integration

`global.data.js` runs **inside the worker**, between page initialization and page rendering.
It must not run in the main process because it uses `import()` which is subject to ESM
caching — the same reason all layout, vars, and page imports happen in the worker.

```
Worker process:
  resolveVars(globalVars)           → bareGlobalVars
  globalVars = { ...defaultVars, ...bareGlobalVars }
  pMap(pages, pageData.init)        → all pages initialized (vars resolved, layout bound)
  resolveGlobalData({ pages })      → globalDataVars        ← runs after init
  stamp globalDataVars onto pages   → page.globalDataVars = globalDataVars
  pMap(pages, pageWriter)           → pages rendered with stamped globalDataVars in vars
```

The step is **lazy**: if `siteData.globalData` is undefined (no file found), `resolveGlobalData`
returns `{}` immediately with no overhead.

## Incremental Rebuild in Watch Mode

`global.data.js` changes should trigger a full page rebuild, same as `global.vars.*`. Since
`global.data` output is stamped onto every page's vars, there is no safe way to know which
pages are affected without re-rendering all of them.

### Watch mode decision tree additions (deferred to progressive-rebuild)

| File pattern | Action |
|---|---|
| `global.vars.*` | Full page rebuild (all pages) |
| `global.data.*` | Full page rebuild (all pages) |  ← to be wired up in progressive-rebuild
| `esbuild.settings.*` | Restart esbuild context + full page rebuild |

Currently, `global.data.*` changes are not watched specially — any watched file change
triggers a full `builder()` call which re-runs `identifyPages()` and the full build, so the
behavior is correct but not yet optimally wired.

## Identifying `global.data.*` in identifyPages ✅

Similar to `global.vars.*`, looks for (respecting whether Node has TS support):

```
global.data.ts / global.data.mts / global.data.cts
global.data.js / global.data.mjs / global.data.cjs
```

Stored in `siteData.globalData` (a `FileInfo` object) alongside `siteData.globalVars`.
Duplicate detection follows the same warning pattern as globalVars
(`DOM_STACK_WARNING_DUPLICATE_GLOBAL_DATA`).

## Removal of postVars ✅

`postVars` has been fully removed:

- `resolvePostVars()` in `resolve-vars.js` throws a hard error with a migration message if
  any `page.vars.*` file exports `postVars`
- `PageData.postVars`, `PageData.#renderedPostVars`, and `PageData.#renderPostVars()` removed
- `PostVarsFunction` / `AsyncPostVarsFunction` typedefs removed from `page-data.js` and
  `index.js`
- `renderInnerPage` and `renderFullPage` now use `this.vars` directly (no postVars merge)

## `GlobalDataFunction` type ✅

- Defined as a `@callback` typedef in `lib/build-pages/index.js`
- Re-exported from `index.js` as `GlobalDataFunction` / `AsyncGlobalDataFunction`
- Used in the test case: `test-cases/general-features/src/global.data.js`

## Files Changed

| File | Change |
|---|---|
| `lib/identify-pages.js` | Added `globalDataNames`, `globalData` detection, `DOM_STACK_WARNING_DUPLICATE_GLOBAL_DATA` |
| `lib/helpers/dom-stack-warning.js` | Added `DOM_STACK_WARNING_DUPLICATE_GLOBAL_DATA` to `DomStackWarningCode` union |
| `lib/build-pages/resolve-vars.js` | Added `resolveGlobalData()`; replaced `checkForPostVars` with `resolvePostVars` (throws on detection) |
| `lib/build-pages/page-data.js` | Added `globalDataVars` field; updated `vars` getter to merge it; calls `resolvePostVars` in `init()` |
| `lib/build-pages/index.js` | Added `GlobalDataFunction`/`AsyncGlobalDataFunction` typedefs; post-init `resolveGlobalData` call + stamp loop |
| `index.js` | Replaced `PostVarsFunction`/`AsyncPostVarsFunction` re-exports with `GlobalDataFunction`/`AsyncGlobalDataFunction` |
| `test-cases/general-features/src/global.data.js` | New — blog index using resolved `PageData[]` API |
| `test-cases/general-features/index.test.js` | Added assertion for `ul.blog-index-list` / `li.blog-entry` in root index.html |
