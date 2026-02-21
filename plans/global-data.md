# Global Data Pipeline

## Problem with postVars

`postVars` is a named export from a `page.vars.*` file that receives the full `pages` array
at render time. It was designed to let pages aggregate data from other pages (blog indexes,
RSS feeds, etc.) but has several problems:

- **Implicit**: any page.vars file might export postVars — there's no way to know without
  importing the file (subject to ESM cache in main process, requires worker detection)
- **Ordering complexity**: postVars pages must render after the pages they read from,
  requiring a two-pass render in the incremental rebuild plan
- **Coupled to page rendering**: data aggregation is entangled with page output, making
  both harder to reason about
- **Mis-scoped**: a blog index page shouldn't need a special callback just to list its
  sibling pages — that's a data pipeline concern, not a page concern

## Proposed Replacement: `global.data.js`

A single optional file at the src root: `global.data.js` (or `.ts`).

It runs once per build, after `identifyPages()` and before `buildPages()`. It receives
the full `PageInfo[]` array and returns an object that is merged into `globalVars` —
available to every page, layout, and template.

### API

```ts
// global.data.ts
import type { PageInfo, GlobalDataFunction } from '@domstack/static'

export default (async ({ pages }) => {
  const blogPosts = pages
    .filter(p => p.path.startsWith('blog/'))
    .sort((a, b) => b.vars.date - a.vars.date)

  return {
    blogPosts,
    recentPosts: blogPosts.slice(0, 5),
  }
}) satisfies GlobalDataFunction
```

The returned object is merged into `globalVars` before pages render:

```js
globalVars = { ...defaultVars, ...bareGlobalVars, ...globalData }
```

### Migration: what a postVars file looks like today vs tomorrow

**Today** (`blog/page.vars.js`):
```js
export default {
  layout: 'blog',
  title: 'Blog',
}

export async function postVars ({ pages }) {
  const posts = pages
    .filter(p => p.path.startsWith('blog/') && p.pageInfo.path !== 'blog')
    .sort((a, b) => new Date(b.vars.date) - new Date(a.vars.date))

  return {
    posts,
  }
}
```

**Tomorrow** — remove postVars from `blog/page.vars.js`:
```js
export default {
  layout: 'blog',
  title: 'Blog',
}
```

Add `global.data.js` (or extend existing one):
```js
export default async function ({ pages }) {
  const blogPosts = pages
    .filter(p => p.path.startsWith('blog/') && p.path !== 'blog')
    .sort((a, b) => new Date(b.vars.date) - new Date(a.vars.date))

  return { blogPosts }
}
```

The blog index page's layout or page function then reads `vars.blogPosts` directly —
no special callback needed.

For RSS/Atom feeds, the template already receives `globalVars` and `pages`, so
`global.data.js`-derived data flows through naturally.

## Build Pipeline Integration

```
identifyPages()       → siteData (includes globalData file if present)
buildEsbuild()        → bundles
buildGlobalData()     → imports global.data.js, calls it with { pages: siteData.pages }
                         returns derived vars merged into globalVars
buildPages()          → renders pages and templates with enriched globalVars
```

`buildGlobalData()` is a new lightweight build step, runs in the main process between
esbuild and page building. Since it uses `import()` it is subject to ESM caching —
it needs to run in the worker alongside `buildPagesDirect()` for the same reason
layout/vars imports do.

## Incremental Rebuild Implications

`global.data.js` is a **data** file, not a rendering file. Invalidation rules:

- `global.data.js` changes → re-run `buildGlobalData()` + rebuild ALL pages + postVars
  (well, there are no more postVars — rebuild all pages)
- Any page file or page.vars changes → re-run `buildGlobalData()` (pages array may have
  changed data) + rebuild affected pages + pages that depend on globalData output

The last point is the key question: **which pages consume `globalVars.blogPosts` etc.?**
We can't know statically. Two options:

**Option A: Always re-run buildGlobalData + all pages on any page data change**
Conservative but simple. If any page's data changes, globalData might produce different
output, so re-render everything. This is essentially the same as today's full rebuild,
but at least we've removed the postVars ordering complexity.

**Option B: Declare consumers explicitly**
Pages that use global data declare it somehow (a convention file, a flag in vars).
Only those pages re-render when globalData changes. More complex, deferred.

**Option C: Re-run buildGlobalData always, but only re-render pages whose globalData
output actually changed**
After re-running `buildGlobalData()`, deep-compare the output to the previous run.
If nothing changed (e.g. a page's content changed but not its title/date/path which
globalData reads), skip the dependent page re-renders. Elegant but requires a stable
comparison of the globalData output object.

## Identifying global.data.js in identifyPages

Similar to `global.vars.*`, `global.css`, etc. — look for:

```
global.data.ts / global.data.mts / global.data.cts
global.data.js / global.data.mjs / global.data.cjs
```

Stored in `siteData.globalData` alongside `siteData.globalVars`.

## Deprecation of postVars

- Keep postVars working in the current release with a deprecation warning
- Remove in a future major version
- The migration path is mechanical: move postVars logic to global.data.js, read the
  result from vars instead of the postVars callback

## Open Questions

- Should `global.data.js` receive the raw `PageInfo[]` (no vars resolved yet) or
  the fully resolved `PageData[]` (vars merged)? Raw PageInfo is available before
  the worker runs. Fully resolved PageData requires the worker to have run first,
  creating a chicken-and-egg problem if globalData output is needed during page init.
  Raw PageInfo with frontmatter available via pageInfo.pageVars filepath seems most
  practical — globalData can import and read those files itself.
- Should templates continue to receive the full `pages` array directly? Probably yes —
  templates are already the right place for output-oriented aggregation, and giving them
  pages directly is simpler than requiring everything to go through globalData.
