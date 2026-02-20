# Global Data Pipeline

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
  page *plus* every page that was detected as a postVars consumer last time. This set is
  discovered only after the first full build, and it never shrinks during a watch session
  even if the user removes postVars from a file.

> **Note**: the original plan described a "two-pass render ordering" problem. This no longer
> applies — the current worker-based implementation initializes all pages concurrently, then
> renders all concurrently. postVars is called lazily inside page rendering when a page needs
> another page's vars. There is no special ordering requirement today.

## Proposed Replacement: `global.data.js`

A single optional file at the src root: `global.data.js` (or `.ts`).

It runs once per build, inside the worker, after all pages are initialized but before
rendering begins. It receives the raw `PageInfo[]` array (not resolved PageData — see
rationale below) and returns an object that is merged into `globalVars` — available to
every page, layout, and template.

### API

```ts
// global.data.ts
import type { PageInfo, GlobalDataFunction } from 'domstack'

export default (async ({ pages }) => {
  const blogPosts = pages
    .filter(p => p.pageFile.relname.startsWith('blog/'))
    .sort((a, b) => new Date(b.frontmatter?.date) - new Date(a.frontmatter?.date))

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

### Why raw PageInfo, not resolved PageData

`global.data.js` runs inside the worker before page rendering. Resolved PageData (merged
vars, layout bound, postVars called) is only available after `pageData.init()` runs for
each page — and `global.data.js` output is needed *as input* to init. Providing raw
`PageInfo[]` avoids the chicken-and-egg problem. PageInfo includes `frontmatter` (for md
pages), the pageVars filepath, and file metadata — enough for data aggregation use cases
like blog indexes, RSS feeds, and sitemaps. If a `global.data.js` function needs resolved
vars it can `import()` the vars file directly, same as the build system does.

### Migration: what a postVars file looks like today vs tomorrow

**Today** (`blog/page.vars.js`):
```js
export default {
  layout: 'blog',
  title: 'Blog',
}

export async function postVars ({ pages }) {
  const posts = pages
    .filter(p => p.pageInfo.pageFile.relname.startsWith('blog/') && p.pageInfo.pageFile.relname !== 'blog/index')
    .sort((a, b) => new Date(b.vars.date) - new Date(a.vars.date))

  return { posts }
}
```

**Tomorrow** — remove postVars from `blog/page.vars.js`:
```js
export default {
  layout: 'blog',
  title: 'Blog',
}
```

Add `global.data.js` at the src root:
```js
export default async function ({ pages }) {
  const blogPosts = pages
    .filter(p => p.pageFile.relname.startsWith('blog/'))
    .sort((a, b) => new Date(b.frontmatter?.date) - new Date(a.frontmatter?.date))

  return { blogPosts }
}
```

The blog index page's layout or page function reads `vars.blogPosts` directly — no special
callback needed.

## Build Pipeline Integration

`global.data.js` runs **inside the worker**, between page initialization and page rendering.
It must not run in the main process because it uses `import()` which is subject to ESM
caching — the same reason all layout, vars, and page imports happen in the worker.

```
Worker process:
  resolveVars(globalVars)      → bareGlobalVars
  pMap(pages, pageData.init)   → all pages initialized (vars resolved, layout bound)
  import(global.data.js)       → globalData function
  globalData({ pages: raw })   → derived vars object        ← NEW STEP (lazy: only if file exists)
  globalVars = { ...globalVars, ...derivedVars }
  pMap(pages, pageWriter)      → pages rendered with enriched globalVars
```

The step is **lazy**: if `siteData.globalData` is undefined (no file found), the step is
skipped entirely with no overhead.

## Incremental Rebuild in Watch Mode

`global.data.js` changes trigger a full page rebuild, same as `global.vars.*`. Since
`global.data` output is merged into `globalVars` which every page receives, there is no
safe way to know which pages are affected without re-rendering all of them.

### Watch mode decision tree additions

The existing chokidar decision tree gains one new entry, inserted after `global.vars.*`:

| File pattern | Action |
|---|---|
| `global.vars.*` | Full page rebuild (all pages) |
| `global.data.*` | Full page rebuild (all pages) |
| `esbuild.settings.*` | Restart esbuild context + full page rebuild |
| ... | (existing rules unchanged) |

### Note on diff-based optimization (not implemented)

A diff-based approach was considered (Option C): run `global.data.js` in a fresh worker,
deep-compare output to the cached previous output, and skip the full rebuild if identical.
This was not implemented because:

1. `global.data.js` output often contains rendered HTML (e.g. blog index markup), which
   would defeat the diff even when the underlying data hasn't changed.
2. A probe worker that only runs `global.data.js` without building pages adds latency and
   complexity for a case (`global.data.*` file itself changed) where a rebuild is almost
   always warranted anyway.
3. The simpler full-rebuild behavior is correct and easy to reason about.

## Identifying `global.data.*` in identifyPages

Similar to `global.vars.*`, look for (respecting whether Node has TS support):

```
global.data.ts / global.data.mts / global.data.cts
global.data.js / global.data.mjs / global.data.cjs
```

Stored in `siteData.globalData` (a `FileInfo` object) alongside `siteData.globalVars`.
Duplicate detection follows the same warning pattern as globalVars.

## Removal of postVars

`postVars` has been fully removed. Attempting to export `postVars` from a `page.vars.*` file
now throws an error with a migration message pointing to `global.data.js`. The migration
path is mechanical: move the aggregation logic to `src/global.data.js` and read the result
from `vars` instead of the `postVars` callback.

## Open Questions (resolved)

- **raw PageInfo vs resolved PageData**: raw PageInfo — see rationale above.
- **Do templates still receive the full `pages` array directly?**: Yes. Templates are already
  the right place for output-oriented aggregation and giving them raw pages directly is
  simpler than routing everything through globalData.
- **Does globalData run in the main process or worker?**: Worker only. ESM cache is the
  deciding factor — same reasoning as all other dynamic imports in the build.
