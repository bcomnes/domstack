# Progressive Rebuild in Watch Mode

## Status: Implemented ✅

All features implemented. Tests pass, linter clean.

---

## Goal

Instead of a full rebuild on every file change, rebuild only the pages affected by the changed file.

## Non-Watch Architecture

```
builder()
  identifyPages()         → siteData
  buildEsbuild()          → bundles all JS/CSS, mutates siteData with hashed output paths
  buildPages() [worker]   → renders all pages and templates
```

## Watch Architecture

Two separate, parallel watch loops:

### Loop 1: esbuild context (JS/CSS)

- `buildEsbuildWatch()` in `lib/build-esbuild/index.js` creates an `esbuild.context()` + calls `.watch()`
- Stable (unhashed) output filenames in watch mode:
  - `entryNames: '[dir]/[name]'` instead of `'[dir]/[name]-[hash]'`
  - `chunkNames: 'chunks/[ext]/[name]'`
  - `outputMap` only needs to be computed once at startup — stable across rebuilds
- A `domstack-on-end` esbuild plugin logs errors after each bundle rebuild
- Since watch mode uses stable filenames, page HTML never changes when bundles rebuild — no
  page rebuild triggered. Browser-sync reloads the browser directly.
- esbuild's `context()` API does NOT support modifying entry points after creation. Adding or
  removing an esbuild entry point requires `dispose()` + recreating the context.

### Loop 2: chokidar (page files)

Chokidar watches for `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, `.css`, `.html`, `.md`
changes (extension whitelist). Uses `atomic: 300` to handle editors that do atomic saves
(temp file + rename), preventing spurious `unlink` + `add` pairs.

On `change`, the decision tree in `#handleChange()` determines the minimal page rebuild set.
On `add`/`unlink`, `#handleAddUnlink()` categorizes the file for targeted rebuild scope.

All chokidar events are serialized through a `#buildLock` promise chain so rapid saves don't
cause overlapping rebuilds.

## Data Structures Built at Startup

After the initial full build, `#rebuildMaps()` builds and maintains these in `DomStack`
private fields:

### 1. `#layoutDepMap: Map<depFilepath, Set<layoutName>>`

Built using `@11ty/dependency-tree-typescript`.
Values are layout *names* (not filepaths) so they can be fed directly into `#layoutPageMap`.

Answers: "which layout names import this changed file?"

### 2. `#layoutPageMap: Map<layoutName, Set<PageInfo>>`

Built by re-resolving each page's `layout` var from its vars files. Lightweight —
just reads `page.vars.*` exports without running a full page render. Falls back to
the default layout name resolved from `default.vars.js` → `global.vars.*` → `'root'`.

Answers: "which pages use this layout?"

### 3. `#pageFileMap: Map<filepath, PageInfo>`

Simple lookup from any page-related file to its PageInfo. Covers both `pageFile` and `pageVars`.

Answers: "is this changed file a page or page vars file, and which page?"

### 4. `#layoutFileMap: Map<filepath, layoutName>`

Direct lookup from a layout's filepath to its name.

Answers: "is this changed file a layout, and what is its name?"

### 5. `#pageDepMap: Map<depFilepath, Set<PageInfo>>`

Built using `@11ty/dependency-tree-typescript` on each `page.js` **and** `page.vars.*` file.
Tracks transitive ESM deps so changes to shared modules trigger the correct page rebuilds.

Answers: "which pages import this changed shared module (via page.js or page.vars)?"

### 6. `#templateDepMap: Map<depFilepath, Set<TemplateInfo>>`

Built using `@11ty/dependency-tree-typescript` on each template file.

Answers: "which templates import this changed shared module?"

### 7. `#esbuildEntryPoints: Set<filepath>`

Built from actual `siteData` properties — the concrete set of absolute filepaths that are
esbuild entry points (globalClient, globalStyle, per-page clientBundle/pageStyle/workers,
per-layout layoutClient/layoutStyle).

Checked **early** in the change decision tree (Rule 6, before dep map lookups) to prevent
esbuild-owned files from accidentally matching dep map rules and triggering unnecessary
page rebuilds.

### Notes on path handling

`@11ty/dependency-tree-typescript`'s `find()` returns CWD-relative paths with a `./` prefix
(e.g. `./lib/build-pages/resolve-vars.js`). `siteData` filepaths are absolute. All dep paths
are `resolve()`d to absolute before being stored as map keys.

## Rebuild Decision Tree (change events)

On a chokidar `change` event for `changedPath`, `#handleChange()` evaluates rules top-down
with early returns:

```
2. global.vars.*
   → Full rebuild (dispose esbuild context, re-run identifyPages, restart esbuild,
     rebuild all pages, rebuild maps)
   → Rationale: the `browser` key is read by buildEsbuild() in the main process and
     passed to esbuild as `define` substitutions. esbuild's own watcher does NOT track
     global.vars as an input, so any change could affect bundle output and requires
     restarting esbuild with fresh `define` values.

3. global.data.*
   → Full page rebuild (all pages, all templates). No esbuild restart.
   → Rationale: global.data.js output is stamped onto every page's vars. There is no
     safe way to know which pages are affected without re-rendering all of them.

4. esbuild.settings.*
   → Full rebuild (dispose esbuild context, re-create, rebuild all pages)

5. markdown-it.settings.*
   → Rebuild all .md pages only (pageFilterPaths = md pages, templateFilterPaths = [])

6. esbuild entry point (#esbuildEntryPoints.has(changedPath))
   → Log "esbuild will handle rebundling" and return. No page rebuild needed.
   → Uses concrete filepath Set from siteData, checked BEFORE dep map rules.

7. Layout file (matches layoutSuffixs + registered in #layoutFileMap)
   → affectedPages = layoutPageMap.get(layoutName)
   → Rebuild affectedPages only

8. Dep of a layout (layoutDepMap.has(changedPath))
   → affectedLayouts = layoutDepMap.get(changedPath)  // Set<layoutName>
   → affectedPages = union of layoutPageMap.get(name) for each layout
   → Rebuild affectedPages only

9. Page file or page.vars file (pageFileMap.has(changedPath))
   → affectedPage = pageFileMap.get(changedPath)
   → Rebuild [affectedPage] only

10. Template file (matches templateSuffixs + registered in siteData.templates)
    → Rebuild just that template

11. Dep of a page.js or page.vars (pageDepMap.has(changedPath))
    → affectedPages = pageDepMap.get(changedPath)
    → Rebuild affectedPages only

12. Dep of a template file (templateDepMap.has(changedPath))
    → affectedTemplates = templateDepMap.get(changedPath)
    → Rebuild affectedTemplates only

13. Otherwise
    → Log "did not match any rebuild rule, skipping"
```

## Add/Unlink Handling

On a chokidar `add` or `unlink` event, `#handleAddUnlink(changedPath, event)` categorizes
the file by basename pattern to determine the minimal rebuild scope:

### esbuild entry point added/removed

Detected by basename pattern matching against known name lists (pageClientNames,
layoutClientSuffixs, layoutStyleSuffix, pageWorkerSuffixs, globalClientNames,
globalStyleNames, pageStyleName).

Steps:
1. Re-identify pages (`identifyPages()`) to discover the new/removed entry point
2. Dispose and recreate esbuild context (entry points changed; esbuild API does not
   support modifying entry points on an existing context)
3. Determine affected pages by entry point scope:
   - **Global assets** (global.client.*, global.css): rebuild all pages
   - **Layout assets** (*.layout.css, *.layout.client.*): rebuild maps first, then
     rebuild only pages using that layout
   - **Page-level assets** (client.*, style.css, *.worker.*): rebuild only the page
     in the same directory (matched via `page.path`)
4. Rebuild maps

### Non-esbuild file added/removed

Any other file (new page, layout, template, config, etc.) is a structural change.
Falls through to `#fullRebuild()` which re-identifies all pages, restarts esbuild,
rebuilds all pages, and rebuilds all maps.

## Logging

### `logRebuildTree(trigger, pages?, templates?)`
Prints BEFORE the build — the trigger filename and an indented tree of affected outputs:
```
"page.js" changed:
  → about/index.html
```

### `buildLogger(results, dest?)`
Prints AFTER the build:
- **Full builds**: Site totals (`Pages: N Layouts: N Templates: N`) + build counts + `Build Success!`
- **Filtered builds**: Each built output file (`Built about/index.html`), then summary
  counts (`Pages built: 1 Templates built: 0`) + `Build Success!`. Requires `dest` to
  relativize absolute output paths from the worker report.

### `errorLogger(err)`
Prints `inspect(err, { depth: 999, colors: true })` + `Build Failed!`

## Testing

### `settled()` method

Public method on `DomStack` that returns `this.#buildLock`. Lets tests await all queued
rebuilds without exposing the private field.

### `test-cases/watch/index.test.js`

Watch mode test suite using `node:test` with `mock.method(console, 'log')` for log capture.
Copies the general-features fixture to a temp directory inside the project tree (so
node_modules resolution works for esbuild bare specifiers). 60-second timeout.

Test cases:
1. Initial build completes with siteData and output files
2. Page file change → only that page rebuilds (content verified in output)
3. Layout change → only pages using that layout rebuild (no full rebuild)
4. esbuild entry point change → no page rebuild (esbuild handles it)
5. Adding client.js → esbuild restart + only that page rebuilds
6. Removing client.js → esbuild restart + only that page rebuilds
7. global.data.js change → all pages rebuild
8. stopWatching completes without error

Uses `t.after()` hooks for cleanup (stopWatching, mock restore, temp dir removal).

## Files Changed

### `lib/build-esbuild/index.js` ✅

- Extracted `extractOutputMap()` and `updateSiteDataOutputPaths()` as shared helpers
- Extracted `assembleBuildOpts()` shared between one-shot and watch builds
- `buildEsbuild()` refactored to use helpers (behavior unchanged for non-watch mode)
- New `buildEsbuildWatch(src, dest, siteData, opts, watchOpts?)`:
  - Uses stable (unhashed) `entryNames`/`chunkNames`
  - Creates `esbuild.context()`, triggers initial `rebuild()` to populate `outputMap`
  - Attaches a `domstack-on-end` plugin that logs errors after each rebuild
  - Calls `.watch()` and returns `{ context, outputMap }` for the caller to manage

### `lib/build-pages/index.js` ✅

- Added `BuildPagesOpts` typedef with `pageFilterPaths` and `templateFilterPaths`
  (filepath arrays, not Sets, for structured-clone serialization over the worker boundary)
- `buildPagesDirect` converts filter arrays to Sets, then:
  - Still inits ALL pages and stamps `globalDataVars` onto all of them (required for correct rendering)
  - Only the write step (pageWriter / templateBuilder) is filtered to the requested subset

### `lib/build-pages/worker.js` ✅

- Passes `opts` from `workerData` through to `buildPagesDirect` so filter arrays reach the worker

### `index.js` ✅

- `watch()` does an inline initial build (not via `builder()`), starting esbuild in watch
  mode immediately to avoid a double build
- After initial build, `#rebuildMaps()` constructs all seven data structures (6 maps + 1 set)
- Chokidar events serialized through a `#buildLock` promise chain (prevents pile-up)
- Chokidar uses `atomic: 300` to handle atomic-save editors gracefully
- `#handleChange(changedPath)` implements the decision tree with esbuild entry check (Rule 6)
  before dep map lookups to prevent false matches
- `#handleAddUnlink(changedPath, event)` categorizes add/unlink by file type for targeted
  rebuilds (esbuild entries get esbuild restart + targeted page rebuild; everything else
  gets full rebuild)
- `#fullRebuild()`: disposes esbuild context, re-identifies pages, restarts in watch mode,
  rebuilds all pages, rebuilds maps
- `#runPageBuild(siteData, pageFilterPaths?, templateFilterPaths?)`: filtered or full page
  rebuild, passes dest to buildLogger for filtered builds
- `stopWatching()` properly disposes the esbuild context
- `settled()`: public method returning `#buildLock` for test synchronization
- `buildLogger(results, dest?)`: shows per-file output for filtered builds

### `test-cases/watch/index.test.js` ✅ (new)

- Watch mode test suite with 8 test cases covering progressive rebuild behavior

## Dependencies Added

- `@11ty/dependency-tree-typescript` — static ESM dep analysis for layout and page dep tracking.
  Handles `.ts` files natively. MIT licensed. Added to `package.json` dependencies.

## Resolved Decisions

- **Worker per render**: Keep spawning a fresh worker per `buildPages()` call. Node's ESM module
  cache means `import()` always returns the cached version within the same process — a fresh
  worker is required to re-import changed modules.
- **layoutDepMap values**: Use `layoutName` (not `layoutFilepath`) as the value so it feeds
  directly into `layoutPageMap` without extra indirection.
- **layoutPageMap source**: Built in `#rebuildMaps()` by calling `resolveVars()` on each page's
  `page.vars.*` file directly — lightweight, no worker needed.
- **global.data.js trigger rule**: Always full page rebuild. Since `global.data.js` output is
  stamped onto every page's vars, there's no safe subset to rebuild. No esbuild restart needed.
- **esbuild onEnd**: No page rebuild triggered. Watch mode uses stable filenames so page HTML
  never references changed bundle paths. Browser-sync reloads the browser directly.
- **esbuild entry point detection**: Uses a concrete `Set<filepath>` built from siteData
  properties, checked BEFORE dep map rules in the decision tree. This prevents dep maps
  (which may contain esbuild entry files as transitive dependencies) from triggering
  unnecessary page rebuilds.
- **Add/unlink granularity**: esbuild entry point add/remove triggers esbuild restart +
  targeted page rebuild (not full site rebuild). esbuild's context API does not support
  modifying entry points, so dispose + recreate is required. Non-esbuild file add/remove
  still triggers full rebuild (structural change to the page set).
- **Path normalization**: `find()` returns CWD-relative `./…` paths; `siteData` uses absolute
  paths. All dep paths are `resolve()`d to absolute before being stored as map keys.
- **Concurrency**: Chokidar events are serialized through `#buildLock` so rapid saves don't
  cause overlapping rebuilds.
- **Filter init vs render split**: All pages are always initialized and have `globalDataVars`
  stamped before the filter is applied to the write step. This ensures filtered pages still
  receive correct global data context from their peers.
