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
- Use an esbuild `onEnd` plugin to log rebuild completion and surface errors
- Since watch mode uses stable (unhashed) filenames, page HTML never changes when bundles rebuild — no page rebuild needed. Browser-sync reloads the browser directly to pick up new JS/CSS from disk.

### Loop 2: chokidar (page files)

Chokidar watches for `.js`, `.ts`, `.md`, `.html` changes. On change, use the decision tree below to determine the minimal page rebuild set.

## Data Structures Built at Startup

After the initial full build, build and maintain these maps:

### 1. `layoutDepMap: Map<depFilepath, Set<layoutName>>`

Built using `@11ty/dependency-tree-typescript`.
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

### 5. `layoutFileMap: Map<filepath, layoutName>`

Direct lookup from a layout's filepath to its name. Used in the decision tree to quickly
identify if a changed file is a layout file without iterating `siteData.layouts`.

Answers: "is this changed file a layout, and what is its name?"

### 6. `pageDepMap: Map<depFilepath, Set<PageInfo>>`

Built using `@11ty/dependency-tree-typescript` on each `page.js` **and** `page.vars.*` file.
Tracks transitive ESM deps so changes to shared modules trigger the correct page rebuilds.

```js
for (const pageInfo of siteData.pages) {
  const filesToTrack = [pageInfo.pageFile.filepath]
  if (pageInfo.pageVars) filesToTrack.push(pageInfo.pageVars.filepath)
  for (const file of filesToTrack) {
    const deps = await find(file)
    for (const dep of deps) {
      if (!pageDepMap.has(dep)) pageDepMap.set(dep, new Set())
      pageDepMap.get(dep).add(pageInfo)
    }
  }
}
```

Answers: "which pages import this changed shared module (via page.js or page.vars)?"

### 7. `templateDepMap: Map<depFilepath, Set<TemplateInfo>>`

Built using `@11ty/dependency-tree-typescript` on each template file. Tracks transitive
ESM deps so changes to shared modules imported by templates trigger the correct template rebuilds.

```js
for (const templateInfo of siteData.templates) {
  const deps = await find(templateInfo.templateFile.filepath)
  for (const dep of deps) {
    if (!templateDepMap.has(dep)) templateDepMap.set(dep, new Set())
    templateDepMap.get(dep).add(templateInfo)
  }
}
```

Answers: "which templates import this changed shared module?"

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
   → Full rebuild (dispose esbuild context, re-run identifyPages, restart esbuild, rebuild all pages)
   → Rationale: the `browser` key is read by buildEsbuild() in the main process and passed to
     esbuild as `define` substitutions. esbuild's own watcher does NOT track global.vars as an
     input, so any change could affect bundle output and requires restarting esbuild with fresh
     `define` values. Simplest to always fullRebuild() rather than diff the browser key.

3. esbuild.settings.*
   → Full rebuild (dispose esbuild context, re-create, rebuild all pages including postVarsPages)
   → Rationale: uses fullRebuild() — esbuild settings could affect bundle output or define values,
     simpler to treat the same as other structural config changes

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

9. Dep of a page.js or page.vars (pageDepMap.has(changedPath))
   → affectedPages = pageDepMap.get(changedPath)
   → Rebuild affectedPages + postVarsPages
   → Rationale: data change — shared module may affect page output or vars

10. Dep of a template file (templateDepMap.has(changedPath))
    → affectedTemplates = templateDepMap.get(changedPath)
    → Rebuild affectedTemplates only, no postVars re-run

11. Any JS/CSS bundle (client.js, page.css, .layout.css, .layout.client.*, etc.)
    → esbuild's own watcher handles these. Stable filenames mean page HTML doesn't
      change, so no page rebuild needed. Falls through to case 12.

12. Otherwise
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

### `lib/build-esbuild/index.js` ✅

- Added `watch` option to `buildEsbuild()`
- When `watch: true`:
  - Uses `entryNames: '[dir]/[name]'` (no hash) — stable filenames across rebuilds
  - Uses `esbuild.context()` instead of `esbuild.build()`
  - Calls `.watch()` on the context
  - Accepts an `onEnd` callback (logs errors; no page rebuild needed due to stable filenames)
  - Returns the context handle for disposal in `stopWatching()`
  - Refactored `extractOutputMap()` and `updateSiteDataOutputPaths()` as shared helpers

### `lib/build-pages/index.js` ✅

- Added `BuildPagesOpts` with `pageFilterPaths` and `templateFilterPaths` (filepath arrays, not Sets, for structured-clone serialization over the worker boundary)
- When filter is set, skips pages/templates not in the set
- Added `postVarsPagePaths: string[]` to `WorkerBuildStepResult` — populated during `buildPagesDirect()` from pages where `pageData.postVars !== null`

### `index.js` ✅

- Initial build inlines the build steps (no `builder()` call) to use watch-mode esbuild from the start, avoiding a double build
- After initial build, constructs seven watch maps: `layoutDepMap`, `layoutPageMap`, `pageFileMap`, `layoutFileMap`, `pageDepMap`, `templateDepMap`
- `postVarsPages` is populated from `postVarsPagePaths` returned by the worker after full builds
- `rebuildMaps()` helper keeps all maps in sync after full rebuilds
- `fullRebuild()` helper: disposes esbuild context, re-identifies pages, restarts esbuild, rebuilds maps
- `runPageBuild(pageFilter?, templateFilter?)` helper: wraps `buildPages()` with filter serialization and postVarsPages update
- Chokidar `change` handler implements the 12-case decision tree
- `add`/`unlink` both call `fullRebuild()`
- esbuild context stored for disposal in `stopWatching()`

## Dependencies Added

- `@11ty/dependency-tree-typescript` — static ESM dep analysis for layout and page dep tracking. Handles `.ts` files natively without needing `stripTypeScriptTypes`. MIT licensed, no heavy deps (just `acorn` + `dependency-graph`).

## Resolved Decisions

- **Worker per render**: Keep spawning a fresh worker per `buildPages()` call. Node's ESM module cache means `import()` always returns the cached version within the same process — a fresh worker is required to re-import changed modules. This is correct and the overhead is acceptable, especially with fewer pages being rebuilt per trigger.
- **layoutDepMap values**: Use `layoutName` (not `layoutFilepath`) as the value so it can be fed directly into `layoutPageMap` without an extra indirection lookup.
- **layoutPageMap source**: Built in `index.js` by calling `resolveVars()` on each page's `page.vars.*` file directly — lightweight, no worker needed, done outside `buildPagesDirect`.
- **postVars trigger rule**: Only re-run postVars on *data* changes (page files, page.vars, global.vars, esbuild.settings). Rendering-only changes (layouts, layout deps, markdown-it settings) do not trigger postVars. esbuild.settings and global.vars use fullRebuild() which rebuilds all pages including postVarsPages.
- **postVarsPages detection**: Must happen inside the worker (same ESM cache constraint). `buildPagesDirect()` adds `postVarsPagePaths: string[]` to its result; `index.js` builds `postVarsPages: Set<PageInfo>` from those paths after the initial build.
- **esbuild onEnd**: No page rebuild triggered. Watch mode uses stable (unhashed) filenames, so page HTML never references changed bundle paths. Browser-sync reloads the browser directly. Adding/removing a bundle file is a structural change handled by chokidar `add`/`unlink` → `fullRebuild()`.

## Implementation Status

All planned features are fully implemented. No known gaps remain.
