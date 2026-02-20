# Progressive Rebuild in Watch Mode

## Goal

Instead of a full rebuild on every file change, rebuild only the pages affected by the changed file.

## Current Architecture

```
builder()
  identifyPages()         → siteData
  buildEsbuild()          → bundles all JS/CSS, mutates siteData with hashed output paths
  buildPages() [worker]   → renders all pages and templates
```

On any file change, the entire `builder()` runs. The chokidar watcher in `index.js` triggers this.

## Proposed Watch Architecture

Two separate, parallel watch loops (as today), but smarter:

### Loop 1: esbuild context (JS/CSS)

- Use `esbuild.context(buildOpts)` + `.watch()` instead of `esbuild.build()`
- Disable hash-based output names in watch mode:
  - `entryNames: '[dir]/[name]'` instead of `'[dir]/[name]-[hash]'`
  - `chunkNames: 'chunks/[ext]/[name]'`
  - This makes output filenames stable across rebuilds — `outputMap` only needs to be computed once at startup
- Use an esbuild `onEnd` plugin to trigger page rebuilds when bundles change
- The `onEnd` callback knows which entry points were affected via the metafile, but since all pages share the same esbuild context, the simplest approach on any esbuild rebuild is: rebuild all pages (esbuild is already fast; this is the CSS/JS change path)

### Loop 2: chokidar (page files)

Chokidar watches for `.js`, `.ts`, `.md`, `.html` changes. On change, use the decision tree below to determine the minimal page rebuild set.

## Data Structures Built at Startup

After the initial full build, build and maintain these maps:

### 1. `layoutDepMap: Map<depFilepath, Set<layoutName>>`

Built using `@11ty/dependency-tree-esm` (or `-typescript` for `.ts` layout files).
Values are layout *names* (not filepaths) so they can be fed directly into `layoutPageMap`.

```js
for (const layout of Object.values(siteData.layouts)) {
  const deps = await find(layout.filepath)
  for (const dep of deps) {
    if (!layoutDepMap.has(dep)) layoutDepMap.set(dep, new Set())
    layoutDepMap.get(dep).add(layout.layoutName)
  }
}
```

Answers: "which layout names import this changed file?"

### 2. `layoutPageMap: Map<layoutName, Set<PageInfo>>`

Built by re-resolving each page's `layout` var from its vars files. This is lightweight —
just reads `page.vars.*` frontmatter/exports without running a full page render. Done in
`index.js` after `identifyPages()`, outside the worker.

```js
for (const pageInfo of siteData.pages) {
  // page.vars exports layout name; fall back to default vars if none
  const pageVars = await resolveVars({ varsPath: pageInfo.pageVars?.filepath })
  const layoutName = pageVars.layout ?? defaultVars.layout
  if (!layoutPageMap.has(layoutName)) layoutPageMap.set(layoutName, new Set())
  layoutPageMap.get(layoutName).add(pageInfo)
}
```

Answers: "which pages use this layout?"

### 3. `postVarsPages: Set<PageInfo>`

Cannot be detected in the main process — `resolvePostVars()` uses `import()` which is subject
to the same ESM module cache problem as layout/page imports. Must be detected inside the worker.

The worker already calls `resolvePostVars()` for every page during `buildPagesDirect()`. Add a
`postVarsPagePaths: string[]` field to `WorkerBuildStepResult` containing the `pageFile.filepath`
of every page where `pageData.postVars !== null`. After the initial build, `index.js` builds the
set by matching those paths back against `siteData.pages`:

```js
const postVarsPagePaths = new Set(pageBuildResults.report.postVarsPagePaths)
const postVarsPages = new Set(
  siteData.pages.filter(p => postVarsPagePaths.has(p.pageFile.filepath))
)
```

Answers: "which pages have postVars and must be re-run on data changes?"

### 4. `pageFileMap: Map<filepath, PageInfo>`

Simple lookup from any page-related file to its PageInfo:

```js
// pageFile itself
pageFileMap.set(page.pageFile.filepath, page)
// page.vars file
if (page.pageVars) pageFileMap.set(page.pageVars.filepath, page)
```

Answers: "is this changed file a page or page vars file, and which page?"

## Core Rule: Rendering vs Data

The key distinction driving all rebuild decisions:

- **Rendering changes** (layout files, layout deps, markdown-it settings) → rebuild affected pages HTML output only, NO postVars re-run. postVars receives frontmatter vars extracted *before* rendering, not rendered HTML.
- **Data changes** (page files, page.vars files, global.vars) → rebuild affected pages + postVarsPages. postVars reads titles, dates, tags etc. from the pages array which may have changed.

## Rebuild Decision Tree

On a chokidar `change` event for `changedPath`:

```
1. Structural change (add/unlink)
   → Full rebuild: re-run identifyPages() + rebuild all maps + restart esbuild context

2. global.vars.*
   → If the browser key changed: full esbuild rebuild + all pages + postVarsPages
   → Otherwise: rebuild ALL pages + postVarsPages (data change, skip esbuild)

3. esbuild.settings.*
   → Full esbuild rebuild (dispose context, re-create) + all pages (no postVars —
     esbuild settings affect bundle output only, not page data)

4. markdown-it.settings.*
   → Rebuild all .md pages only, NO postVars re-run
   → Rationale: rendering-only change — frontmatter vars are extracted before rendering

5. Layout file (matches layoutSuffixs)
   → affectedPages = layoutPageMap.get(layoutName)
   → Rebuild affectedPages only, NO postVars re-run
   → Rationale: rendering-only change

6. Dep of a layout (layoutDepMap.has(changedPath))
   → affectedLayouts = layoutDepMap.get(changedPath)  // Set<layoutName>
   → affectedPages = union of layoutPageMap.get(name) for each affectedLayout
   → Rebuild affectedPages only, NO postVars re-run
   → Rationale: rendering-only change

7. Page file or page.vars file (pageFileMap.has(changedPath))
   → affectedPage = pageFileMap.get(changedPath)
   → Rebuild [affectedPage] first, then postVarsPages with updated pages array
   → Rationale: data change — frontmatter/vars in pages array may have changed

8. Template file (matches templateSuffixs)
   → Rebuild just that template, no postVars re-run

9. Otherwise
   → Log and skip
```

## postVars Ordering

postVars is only re-run when page *data* changes (page files or page.vars files), not when layout files change. Layout changes only affect HTML rendering, not the data (titles, dates, vars) that postVars functions consume.

When rebuilding `affectedPages + postVarsPages` (triggered by a page/vars file change):

1. Resolve and render `affectedPages` first (these have changed data)
2. Then resolve and render `postVarsPages` using the updated `pages` array

This ensures `postVars` functions see the freshly-rendered `affectedPages` data.

Pages that appear in both sets (a page with postVars that is also directly affected) are rendered once, in step 1, with their own `postVars` run as normal.

## Files to Change

### `lib/build-esbuild/index.js`

- Add a `watch` option to `buildEsbuild()`
- When `watch: true`:
  - Use `entryNames: '[dir]/[name]'` (no hash)
  - Use `esbuild.context()` instead of `esbuild.build()`
  - Call `.watch()` on the context
  - Accept an `onEnd` callback to notify the page rebuild loop
  - Return the context handle so it can be disposed on `stopWatching()`

### `lib/build-pages/index.js`

- Add a `pageFilter` option to `buildPagesDirect()` (and `buildPages()`) accepting a `Set<PageInfo>` or `null` (null = all pages)
- When `pageFilter` is set, skip pages not in the set
- Add a `templateFilter` option similarly
- Add `postVarsPagePaths: string[]` to `WorkerBuildStepResult` — populated during `buildPagesDirect()` from pages where `pageData.postVars !== null`

### `index.js`

- After initial build, construct the four maps above
- Replace the chokidar `change` handler with the decision tree
- Wire esbuild `onEnd` to trigger page rebuilds
- On `add`/`unlink`, do a full rebuild and reconstruct maps
- Store the esbuild context for disposal in `stopWatching()`

## Dependencies to Add

- `@11ty/dependency-tree-esm` — for layout dep tracking (static ESM analysis)
- Or `@11ty/dependency-tree-typescript` — if `.ts` layout files need to be tracked (domstack supports `.ts` layouts; this package handles them without needing Node's `stripTypeScriptTypes`)

Both are from the 11ty project, ESM, MIT licensed, no heavy deps (just `acorn` + `dependency-graph`).

## Resolved Decisions

- **Worker per render**: Keep spawning a fresh worker per `buildPages()` call. Node's ESM module cache means `import()` always returns the cached version within the same process — a fresh worker is required to re-import changed modules. This is correct and the overhead is acceptable, especially with fewer pages being rebuilt per trigger.
- **layoutDepMap values**: Use `layoutName` (not `layoutFilepath`) as the value so it can be fed directly into `layoutPageMap` without an extra indirection lookup.
- **layoutPageMap source**: Built in `index.js` by calling `resolveVars()` on each page's `page.vars.*` file directly — lightweight, no worker needed, done outside `buildPagesDirect`.
- **postVars trigger rule (Option A)**: Only re-run postVars on *data* changes (page files, page.vars, global.vars). Rendering-only changes (layouts, layout deps, markdown-it settings, esbuild settings) do not trigger postVars. Rationale: postVars receives frontmatter vars extracted before rendering, not rendered HTML.
- **postVarsPages detection**: Must happen inside the worker (same ESM cache constraint). `buildPagesDirect()` adds `postVarsPagePaths: string[]` to its result; `index.js` builds `postVarsPages: Set<PageInfo>` from those paths after the initial build.
- **esbuild onEnd**: Rebuild all pages on any esbuild rebuild (CSS/JS change path). No attempt to narrow by entry point for now.

## Deferred / Future Work

- **Page JS dep tracking**: A page's `page.js` can import shared local modules. A change to those modules currently falls through to case 9 (log and skip). Could add a `pageDepMap` using the same dep tracker on page files in a follow-up.
