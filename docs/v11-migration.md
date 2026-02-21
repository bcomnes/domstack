# Migration Guide: top-bun → domstack

This guide covers all breaking changes introduced in the `next` branch relative to `master`, documenting what needs to change when migrating from `top-bun` to `domstack` (`@domstack/static`).

## Table of Contents

1. [Package and Installation](#1-package-and-installation)
2. [CLI Binary Names](#2-cli-binary-names)
3. [Programmatic API: Class Rename](#3-programmatic-api-class-rename)
4. [TypeScript Type Renames](#4-typescript-type-renames)
5. [Error Classes and Codes](#5-error-classes-and-codes)
6. [Warning Codes](#6-warning-codes)
7. [postVars Removed → global.data.js](#7-postvars-removed--globaldatajs)
8. [New Reserved Filenames](#8-new-reserved-filenames)
9. [page.md Now Recognized](#9-pagemd-now-recognized)
10. [Web Worker Files Bundled Automatically](#10-web-worker-files-bundled-automatically)
11. [browserVars + esbuild define Conflict Now Throws](#11-browservars--esbuild-define-conflict-now-throws)
12. [Default Layout: uhtml-isomorphic → preact](#12-default-layout-uhtml-isomorphic--preact)
13. [Default siteName Changed](#13-default-sitename-changed)
14. [Output File Changes](#14-output-file-changes)
15. [Watch Mode: Unhashed Filenames](#15-watch-mode-unhashed-filenames)
16. [TypeScript: Removed and Changed Exported Types](#16-typescript-removed-and-changed-exported-types)

---

## 1. Package and Installation

The npm package has been renamed.

```sh
# Before
npm install top-bun

# After
npm install @domstack/static
```

All `import`/`require` statements referencing `top-bun` must be updated:

```ts
// Before
import type { LayoutFunction, PageFunction } from 'top-bun'

// After
import type { LayoutFunction, PageFunction } from '@domstack/static'
```

---

## 2. CLI Binary Names

The CLI binary names changed. Update all `package.json` scripts, CI pipelines, and shell aliases:

| Before | After |
|--------|-------|
| `top-bun` | `domstack` |
| `tb` | `dom` |

```json
// package.json scripts - Before
{
  "scripts": {
    "build": "top-bun src dest",
    "watch": "tb src dest --watch"
  }
}

// package.json scripts - After
{
  "scripts": {
    "build": "domstack src dest",
    "watch": "dom src dest --watch"
  }
}
```

---

## 3. Programmatic API: Class Rename

The main class exported by the package was renamed:

```js
// Before
import { TopBun } from 'top-bun'
const site = new TopBun(src, dest, opts)

// After
import { DomStack } from '@domstack/static'
const site = new DomStack(src, dest, opts)
```

---

## 4. TypeScript Type Renames

The main options type was renamed:

```ts
// Before
import type { TopBunOpts } from 'top-bun'

// After
import type { DomStackOpts } from '@domstack/static'
```

---

## 5. Error Classes and Codes

Both exported error classes were renamed, as were their `.code` string values:

| Before | After |
|--------|-------|
| `TopBunAggregateError` | `DomStackAggregateError` |
| `TopBunDuplicatePageError` | `DomStackDuplicatePageError` |
| `'TOP_BUN_ERROR_DUPLICATE_PAGE'` | `'DOM_STACK_ERROR_DUPLICATE_PAGE'` |

Update any `instanceof` checks and error code comparisons:

```js
// Before
import { TopBunDuplicatePageError } from 'top-bun'
try { ... } catch (err) {
  if (err instanceof TopBunDuplicatePageError) { ... }
  if (err.code === 'TOP_BUN_ERROR_DUPLICATE_PAGE') { ... }
}

// After
import { DomStackDuplicatePageError } from '@domstack/static'
try { ... } catch (err) {
  if (err instanceof DomStackDuplicatePageError) { ... }
  if (err.code === 'DOM_STACK_ERROR_DUPLICATE_PAGE') { ... }
}
```

---

## 6. Warning Codes

All warning code strings changed their prefix from `TOP_BUN_WARNING_` to `DOM_STACK_WARNING_`. Additionally, several new warning codes were added.

| Before | After |
|--------|-------|
| `TOP_BUN_WARNING_DUPLICATE_LAYOUT` | `DOM_STACK_WARNING_DUPLICATE_LAYOUT` |
| `TOP_BUN_WARNING_DUPLICATE_LAYOUT_STYLE` | `DOM_STACK_WARNING_DUPLICATE_LAYOUT_STYLE` |
| `TOP_BUN_WARNING_ORPHANED_LAYOUT_STYLE` | `DOM_STACK_WARNING_ORPHANED_LAYOUT_STYLE` |
| `TOP_BUN_WARNING_DUPLICATE_LAYOUT_CLIENT` | `DOM_STACK_WARNING_DUPLICATE_LAYOUT_CLIENT` |
| `TOP_BUN_WARNING_ORPHANED_LAYOUT_CLIENT` | `DOM_STACK_WARNING_ORPHANED_LAYOUT_CLIENT` |
| `TOP_BUN_WARNING_NO_ROOT_LAYOUT` | `DOM_STACK_WARNING_NO_ROOT_LAYOUT` |
| `TOP_BUN_WARNING_UNKNOWN_PAGE_BUILDER` | `DOM_STACK_WARNING_UNKNOWN_PAGE_BUILDER` |
| `TOP_BUN_WARNING_DUPLICATE_GLOBAL_STYLE` | `DOM_STACK_WARNING_DUPLICATE_GLOBAL_STYLE` |
| `TOP_BUN_WARNING_DUPLICATE_GLOBAL_CLIENT` | `DOM_STACK_WARNING_DUPLICATE_GLOBAL_CLIENT` |
| `TOP_BUN_WARNING_DUPLICATE_ESBUILD_SETTINGS` | `DOM_STACK_WARNING_DUPLICATE_ESBUILD_SETTINGS` |
| `TOP_BUN_WARNING_DUPLICATE_GLOBAL_VARS` | `DOM_STACK_WARNING_DUPLICATE_GLOBAL_VARS` |
| _(new)_ | `DOM_STACK_WARNING_DUPLICATE_MARKDOWN_IT_SETTINGS` |
| _(new)_ | `DOM_STACK_WARNING_DUPLICATE_GLOBAL_DATA` |
| _(new)_ | `DOM_STACK_WARNING_PAGE_MD_SHADOWS_README` |

Update any code that switches on or string-matches warning codes.

---

## 7. postVars Removed → global.data.js

**This is the most significant functional breaking change.**

The `postVars` named export from `page.vars.js` files is completely removed. Any file that still exports `postVars` will **throw a hard error at build time**:

```
Error: postVars is no longer supported (found in <varsPath>). Move data aggregation to a global.data.js file instead.
```

**Migration:** Move your `postVars` logic from any `page.vars.js` file into a new top-level `global.data.js` (or `.ts`, `.mjs`, `.mts`) file.

```js
// Before: some-page/page.vars.js
export const vars = { ... }

export const postVars = async ({ pages }) => {
  const blogPosts = pages.filter(p => p.url.startsWith('/blog/'))
  return { blogPosts }
}
```

```js
// After: global.data.js (anywhere in src tree, first found wins)
export default async function ({ pages }) {
  const blogPosts = pages.filter(p => p.url.startsWith('/blog/'))
  return { blogPosts }
}
```

Key differences:
- There is only **one** `global.data.js` per project (the first one found wins; duplicates emit a warning)
- The function is the **default export**, not a named `postVars` export
- The returned data is stamped onto **every** page's vars (same behavior as `postVars` was)
- The types `PostVarsFunction` and `AsyncPostVarsFunction` are replaced by `GlobalDataFunction` and `AsyncGlobalDataFunction`

---

## 8. New Reserved Filenames

Two new filenames are now recognized and processed by domstack. If you have existing files with these names used for other purposes, they will now be treated as special files:

### `global.data.js` (and `.ts`, `.mjs`, `.mts`, `.cjs`, `.cts`)

Now treated as the global data aggregation file. Its default export is called with `{ pages }` after all pages are initialized. See [section 7](#7-postvars-removed--globaldatajs) above.

### `markdown-it.settings.js` (and `.ts`, `.mjs`, `.mts`, `.cjs`, `.cts`)

Now treated as the markdown-it configuration file. Its default export is called with the current markdown-it instance and must return a (possibly new) markdown-it instance.

```js
// markdown-it.settings.js
export default function (md) {
  return md.use(somePlugin)
}
```

If you have a file with either of these names that was serving another purpose, rename it.

---

## 9. page.md Now Recognized

A new page entrypoint filename `page.md` is now supported alongside `README.md`.

- If both `page.md` and `README.md` exist in the same directory, `page.md` takes precedence and `README.md` is silently shadowed (a `DOM_STACK_WARNING_PAGE_MD_SHADOWS_README` warning is emitted)
- Links to `page.md` in markdown content are rewritten to clean directory URLs the same way `README.md` links are

**Action required:** If you have any file named `page.md` in a page directory that you did not intend to be a page entrypoint, rename it.

---

## 10. Web Worker Files Bundled Automatically

Files matching the pattern `{name}.worker.{js,ts,mjs,mts,cjs,cts}` inside a page directory are now automatically recognized as Web Worker entry points. They are bundled by esbuild and a `workers.json` manifest is written alongside the page's `index.html`.

**Action required:** If you have files with the `.worker.js` (or similar) suffix in any page directory that you did not intend to be bundled as workers, rename them.

---

## 11. browserVars + esbuild define Conflict Now Throws

Using the `browser` export in `global.vars.js` while also setting `define` in `esbuild.settings.js` now throws a hard build error:

```
Error: Conflict: both the "browser" export in global.vars and "define" in esbuild.settings are set. Use one or the other to define browser constants.
```

Previously this silently allowed both to coexist. Choose one approach:

- Use `browser` in `global.vars.js` for simple key/value browser constants, **or**
- Use `define` in `esbuild.settings.js` for full control over esbuild's define option

---

## 12. Default Layout: uhtml-isomorphic → preact

The bundled default `root.layout.js` (used when `--eject` has not been run, or when using the default layout) was rewritten from `uhtml-isomorphic` to use `preact` + `preact-render-to-string`.

- `uhtml-isomorphic` is **no longer a production dependency** of `@domstack/static`
- `preact` and `preact-render-to-string` are now production dependencies

**Action required:**
- If your layout files import `uhtml-isomorphic` and rely on it being hoisted from domstack's `node_modules`, you must now add it explicitly to your project:
  ```sh
  npm install uhtml-isomorphic
  ```
- If you were using the unenjoyed default layout, the rendered HTML structure is equivalent but the implementation changed. No action needed unless you were relying on implementation details.

---

## 13. Default siteName Changed

The built-in default `siteName` variable changed from `'top-bun website'` to `'domstack website'`.

This only affects sites that do **not** override `siteName` in their own `global.vars.js`. To keep the old value or set a custom one:

```js
// global.vars.js
export const vars = {
  siteName: 'My Site Name',
  // ...
}
```

---

## 14. Output File Changes

Several filenames in the `dest` (output) directory changed. Update any tooling, scripts, CI pipelines, or CDN/cache configurations that reference these paths:

### esbuild metafile

| Before | After |
|--------|-------|
| `dest/top-bun-esbuild-meta.json` | `dest/dom-stack-esbuild-meta.json` |

### Default layout assets

| Before | After |
|--------|-------|
| `dest/top-bun-defaults/default.style-[hash].css` | `dest/dom-stack-defaults/default.style-[hash].css` |
| `dest/top-bun-defaults/default.client-[hash].js` | `dest/dom-stack-defaults/default.client-[hash].js` |

---

## 15. Watch Mode: Unhashed Filenames

In `--watch` mode, esbuild now uses **stable, unhashed** output filenames instead of content-hashed ones:

| Mode | Before | After |
|------|--------|-------|
| `--watch` | `bundle-[hash].js` | `bundle.js` |
| One-shot build | `bundle-[hash].js` | `bundle-[hash].js` (unchanged) |

This is intentional to improve watch mode incremental rebuild performance. If any scripts or tooling read the `dest` directory during watch and dynamically discover JS/CSS filenames, they should handle both hashed and unhashed patterns, or only be used in production (one-shot) builds where hashing still applies.

---

## 16. TypeScript: Removed and Changed Exported Types

### Removed exports

| Removed Type | Replacement |
|-------------|-------------|
| `TopBunOpts` | `DomStackOpts` |
| `TopBunWarning` | `DomStackWarning` |
| `TopBunWarningCode` | `DomStackWarningCode` |
| `PostVarsFunction` | `GlobalDataFunction` |
| `AsyncPostVarsFunction` | `AsyncGlobalDataFunction` |

### New exports

- `AsyncLayoutFunction` — async variant of `LayoutFunction`
- `AsyncPageFunction` — async variant of `PageFunction`
- `GlobalDataFunction` — replaces `PostVarsFunction`
- `AsyncGlobalDataFunction` — replaces `AsyncPostVarsFunction`
- `DomStackOpts`, `DomStackWarning`, `DomStackWarningCode`

### Changed signatures

`LayoutFunction` and `PageFunction` now accept additional generic type parameters for more precise typing:

```ts
// LayoutFunction now accepts 3 type params: <Vars, PageReturn, LayoutReturn>
// PageFunction now accepts 2 type params: <Vars, PageReturn>

import type { LayoutFunction, PageFunction } from '@domstack/static'

// Fully typed layout
const layout: LayoutFunction<MyVars, string, string> = async ({ vars, children }) => { ... }

// Fully typed page
const page: PageFunction<MyVars, string> = async ({ vars }) => { ... }
```

---

## Quick Checklist

- [ ] Update `package.json` dependency: `top-bun` → `@domstack/static`
- [ ] Run `npm install`
- [ ] Update `package.json` scripts: `top-bun`/`tb` → `domstack`/`dom`
- [ ] Update all `import`/`require` from `'top-bun'` → `'@domstack/static'`
- [ ] Replace `new TopBun(...)` with `new DomStack(...)`
- [ ] Replace `TopBunOpts` type with `DomStackOpts`
- [ ] Replace `TopBunAggregateError`/`TopBunDuplicatePageError` with `DomStack*` equivalents
- [ ] Replace `TOP_BUN_*` error/warning codes with `DOM_STACK_*`
- [ ] Migrate `postVars` exports from `page.vars.js` to a `global.data.js` default export
- [ ] Rename any files accidentally named `global.data.js`, `markdown-it.settings.js`, `page.md`, or `*.worker.js` that weren't intended for those purposes
- [ ] If using both `browser` in `global.vars.js` and `define` in `esbuild.settings.js`, consolidate to one
- [ ] If importing `uhtml-isomorphic` from layouts without it in your own `package.json`, add it explicitly
- [ ] Update any CI/scripts referencing `top-bun-esbuild-meta.json` → `dom-stack-esbuild-meta.json`
- [ ] Update any CI/scripts referencing `top-bun-defaults/` → `dom-stack-defaults/` in the output dir
- [ ] Override `siteName` in `global.vars.js` if you were relying on the default value
