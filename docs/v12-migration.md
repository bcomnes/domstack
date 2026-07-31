# Migration Guide: domstack v12

This guide covers breaking and notable changes when moving from domstack v11 to v12.

If you are migrating from `top-bun`, first follow the historical v11 guide at [v11-migration.md](v11-migration.md).
Then apply the v12 changes below.

## Table of Contents

1. [Type exports moved to `@domstack/static/types.js`](#1-type-exports-moved-to-domstackstatictypesjs)
2. [Development Server Uses @domstack/sync](#2-development-server-uses-domstacksync)
3. [Default Layout Uses fragtml](#3-default-layout-uses-fragtml)
4. [Layout Modules Can Export Vars](#4-layout-modules-can-export-vars)
5. [Keep Layout Dependencies Explicit](#5-keep-layout-dependencies-explicit)
6. [JSX Runtime Is Opt-In](#6-jsx-runtime-is-opt-in)
7. [mine.css v11 and CSS Cascade Layers](#7-minecss-v11-and-css-cascade-layers)
8. [CLI `--target` moved to `esbuild.settings.*`](#8-cli---target-moved-to-esbuildsettings)
9. [Static Cache Manifest and Service Worker Preview](#9-static-cache-manifest-and-service-worker-preview)
10. [Migration Checklist](#10-migration-checklist)

---

## 1. Type exports moved to `@domstack/static/types.js`

In v12, runtime values remain available from `@domstack/static`.
Public types have moved to a dedicated type-only entry.

```ts
// Before v12
import type { LayoutFunction, PageFunction, DomStackOpts } from '@domstack/static'

// v12+
import type { LayoutFunction, PageFunction, DomStackOpts } from '@domstack/static/types.js'
```

---

## 2. Development Server Uses @domstack/sync

Watch/serve mode now uses [`@domstack/sync`](https://www.npmjs.com/package/@domstack/sync) for the local development server.

This provides live reload, CSS injection, ghost mode, and the UI panel.
If you were relying on BrowserSync-specific behavior or output, update your expectations around logs, access URLs, and reload handling.

---

## 3. Default Layout Uses fragtml

The bundled default `root.layout.js` now uses [`fragtml`](https://github.com/bcomnes/fragtml#readme) for server-side HTML rendering.

If you rely on the bundled default layout, make sure your pages and child layouts return compatible values.
The v12 default layout accepts HTML strings and `fragtml` template results.
It does not render Preact or HTM VNodes.

If you already ejected or provide your own root layout, you do not have to change that layout for v12.
Keep the dependencies that your layout imports in your own `package.json`.

If you want to update to v12 while keeping the v11 Preact default layout, run `domstack --eject` on v11 before upgrading.
Then keep `htm`, `preact`, and `preact-render-to-string` installed after the upgrade.

If you want to migrate an ejected Preact/HTM layout to the v12 default style, update your layout imports and rendering code from Preact/HTM to `fragtml`.

```js
// Before
import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'
```

```js
// After
import { html, raw, render } from 'fragtml'
```

Use `raw(htmlString)` when intentionally inserting already-rendered HTML.
Markdown output passed to a layout as `children` is one example.

---

## 4. Layout Modules Can Export Vars

Layouts can now export optional `vars` that are merged into the resolved page variable cascade for pages using that layout. Like page/global vars, layout vars may be an object, a sync function, or an async function.

```ts
// src/layouts/article.layout.ts
export const vars = {
  showSidebar: true,
  pageType: 'article',
}
```

Precedence is:

```txt
page/frontmatter vars > page.vars.* > layout vars > global.data/global.vars > domstack defaults
```

Layout vars were added so shared defaults—especially manifest and service-worker policy defaults—can participate in the normal variable cascade instead of being mixed into rendered output by each layout. If an existing layout manually merges defaults into the values it passes to a child layout or template, move those defaults to the layout's exported `vars` so page and frontmatter vars can override them consistently.

This is additive for most sites. If a layout module already exported a named `vars` value for another purpose, that value will now participate in page variable resolution. Rename that export if it was not intended as layout defaults.

---

## 5. Keep Layout Dependencies Explicit

DOMStack only installs dependencies for its bundled defaults.
Your project is responsible for any packages imported by pages, layouts, globals, or browser clients.

If your ejected layout or server-side pages import `htm/preact`, `preact`, or `preact-render-to-string`, keep those packages in your own `package.json`.
If you migrate those server-side templates to `fragtml`, replace those dependencies with `fragtml`.

---

## 6. JSX Runtime Is Opt-In

Client `.jsx` and `.tsx` bundles are still supported through esbuild.
Domstack no longer configures Preact as the default JSX runtime.

If your browser client code uses JSX or TSX, install the runtime you want and configure it with `esbuild.settings`.

For Preact:

```sh
npm install preact
```

```js
// src/esbuild.settings.js
export default async function esbuildSettingsOverride (esbuildSettings) {
  esbuildSettings.jsx = 'automatic'
  esbuildSettings.jsxImportSource = 'preact'

  return esbuildSettings
}
```

For React:

```sh
npm install react react-dom
```

```js
// src/esbuild.settings.js
export default async function esbuildSettingsOverride (esbuildSettings) {
  esbuildSettings.jsx = 'automatic'
  esbuildSettings.jsxImportSource = 'react'

  return esbuildSettings
}
```

---

## 7. mine.css v11 and Optional CSS Layers

DOMStack v12 updates its bundled default stylesheet from mine.css v10 to v11.
Sites that use the bundled default layout and stylesheet receive the update without changing their source.
The migration steps below apply only when a project imports mine.css directly, has ejected DOMStack's defaults, or has customized behavior removed by mine.css v11.
Review the complete [mine.css v11 migration guide](https://github.com/bcomnes/mine.css/blob/master/MIGRATION.md) in those cases.

mine.css v11 is CSS-only.
Its package root now resolves to the main stylesheet, and its JavaScript theme switcher is no longer published.
Direct consumers should replace the old deep import with the package root:

```css
@import 'mine.css';
```

Direct or ejected consumers should remove JavaScript imports of `mine.css` or `mine.css/dist/theme-switcher.js`, calls to `toggleTheme()`, stored theme state, theme controls, and `.light-mode` or `.dark-mode` rules.
Custom root layouts that use mine.css should include `<meta name="color-scheme" content="light dark">` and use `prefers-color-scheme` for application-specific dark styles.
If an ejected stylesheet uses Highlight.js, load a light theme normally and a dark theme conditionally instead of applying one dark theme in both modes.

The optional mine.css layout remains a separate import.
DOMStack's default stylesheet imports it explicitly, and ejected sites that want the same layout should continue to do so.

### Optional cascade-layer pattern

The main mine.css stylesheet places its framework rules in the low-priority `mine` layer.
DOMStack's default stylesheet imports mine.css normally and places its optional layout and Highlight.js sidecars in `domstack.default`:

```css
@import 'mine.css';
@import 'mine.css/dist/layout.css' layer(domstack.default);
@import 'highlight.js/styles/github.css' layer(domstack.default);
@import 'highlight.js/styles/github-dark-dimmed.css' layer(domstack.default) (prefers-color-scheme: dark);
```

Custom stylesheets do not have to use layers.
Unlayered author rules override normal declarations in `mine` and `domstack.default`.

Projects that want explicit layers can let each DOMStack stylesheet declare only its own scope:

```css
/* global.css */
@layer domstack.global {
  /* Site-wide rules */
}
```

```css
/* article.layout.css */
@layer domstack.layout {
  /* Layout rules */
}
```

```css
/* style.css */
@layer domstack.page {
  /* Page rules */
}
```

No stylesheet needs to enumerate the other scopes.
DOMStack loads default, global, layout, and page styles in that order, so the layers are first encountered with the corresponding low-to-high precedence.
This is a recommended organizational pattern, not a migration requirement.

mine.css v11 intentionally changes typography, forms, tables, media framing, motion, focus treatment, and the optional `.mine-layout` width.
Direct, ejected, or heavily customized consumers should review those surfaces against the upstream migration guide.
The distributed CSS uses native CSS nesting, and mine.css requires Node.js 22 or newer and npm 10 or newer for installation.

---

## 8. CLI `--target` moved to `esbuild.settings.*`

The `domstack --target` / `domstack -t` CLI flag has been removed in v12. Configure esbuild targets in
`esbuild.settings.*` instead.

```js
// src/esbuild.settings.js
export default function esbuildSettings (opts) {
  return {
    ...opts,
    target: ['es2022', 'chrome120', 'firefox121', 'safari17'],
  }
}
```

Domstack does not set a rolling “modern browser” target by default. If your project needs specific
syntax lowering, set explicit esbuild targets in this settings file. See
[esbuild's target docs](https://esbuild.github.io/api/#target) for accepted values.

---

## 9. Static Cache Manifest and Service Worker Preview

v12 adds an unstable-preview manifest pipeline for static caching and first-class site service-worker builds.

These APIs are preview APIs.
Their names, option shapes, manifest schema, generated output, and runtime semantics may change outside of a major version while they are validated with real PWA use cases.
Pin `@domstack/static` to an exact version if you rely on this contract.

### Add a site service worker

A service worker is the browser entrypoint that installs cache contents, intercepts requests, and applies offline/update behavior. Domstack now discovers one `service-worker.*` source module anywhere under `src` and bundles it to the stable public URL `/service-worker.js`.

Domstack does not register the service worker for you. Your app owns registration timing, update prompts, local-development opt-outs, reset/recovery behavior, route filtering, offline fallback behavior, and runtime cache policy.

The service worker can read Domstack's build-time browser defines:

| Define | Value |
| --- | --- |
| `process.env.DOMSTACK_MANIFEST_URL` | Standard public URL for the built-in manifest, `/domstack-manifest.json` |
| `process.env.DOMSTACK_MANIFEST_VERSION` | Finalized manifest version in `/service-worker.js`; `""` in other bundles |
| `process.env.DOMSTACK_MANIFEST_ENABLED` | `"true"` for one-shot builds with an enabled manifest pipeline, `"false"` when disabled or in watch mode |
| `process.env.DOMSTACK_SERVICE_WORKER_URL` | Public URL of the site service worker, usually `/service-worker.js`, or `""` when no service worker is present |
| `process.env.DOMSTACK_SERVICE_WORKER_SCOPE` | Registration scope for the site service worker, usually `/`, or `""` when no service worker is present |

### Configure the manifest in a settings module

Add one `domstack-manifest.settings.*` module anywhere under `src`, using the same supported module extensions as other Domstack settings files. The settings module enables the manifest pipeline and is the primary place to select application vars, define root policy, filter entries, and register build hooks.

Use `manifestVars` to expose selected page, layout, global, or default vars on manifest entries. Use `policy` for values shared by the whole application. Use `includeEntry(entry)` and `exclude` to filter final public output entries.

```ts
import type { DomstackManifestOptions } from '@domstack/static/types.js'

const settings = {
  manifestVars: ['offline', 'precache'],
  policy: {
    offlineFallbackUrl: '/offline/',
  },
  exclude: ['admin/**', 'blog/**', '**/*.map'],
  includeEntry (entry) {
    if (entry.kind === 'metadata') return false
    if (entry.kind === 'sourcemap') return false
    if (entry.manifestVars?.offline === false) return false
    if (entry.manifestVars?.precache === false) return false
    return true
  },
} satisfies DomstackManifestOptions

export default settings
```

A settings module returns `results.domstackManifest` and runs manifest hooks, but does not write public JSON unless writing is explicitly enabled.

### Inject finalized policy into the service worker

The primary service-worker integration point is `hooks.manifestBuilt`.
This hook receives the finalized manifest before the final `/service-worker.js` bundle is emitted.
Use `context.defineServiceWorkerConstant()` to inject JSON-serializable policy directly into the service-worker bundle.

```ts
import type {
  DomstackManifestBuiltHookContext,
} from '@domstack/static/types.js'

export async function injectServiceWorkerPolicy (
  context: DomstackManifestBuiltHookContext
): Promise<void> {
  context.defineServiceWorkerConstant('__APP_CACHE_POLICY__', {
    version: context.manifest.version,
    precacheEntries: context.manifest.entries.map(entry => ({
      url: entry.url,
      revision: entry.urlRevisioned ? null : entry.revision,
    })),
  })
}
```

Bundling the finalized URL/revision list into the service worker is the standard precache workflow: the installed worker receives policy for exactly the outputs produced by the same build. If you intentionally need a separate custom artifact, write it from the hook with `context.writeFile()`.

### Optionally write a public manifest

Most service-worker integrations only need the settings module and `manifestBuilt` hook. Write `/domstack-manifest.json` when another runtime or deployment tool needs to fetch the manifest:

```sh
domstack --domstackManifest
```

Programmatic builds can opt in with `domstackManifest: true`; the object form is available for callers that need to override settings or writing behavior.

### Use `--serve` for PWA testing

Watch mode intentionally does not write or return the domstack manifest.
It still rebuilds the site service worker, but watch-mode output is not representative of production cache invalidation.

Use `--serve` when testing PWA install/update/offline lifecycle behavior:

```sh
domstack --serve
```

Add `--domstackManifest` only if you also want to serve the public `domstack-manifest.json` file while debugging:

```sh
domstack --serve --domstackManifest
```

### Avoid circular manifest dependencies

The built-in manifest file is never included in its own `entries`.
Site service workers are also omitted from manifest entries.
This lets Domstack inject the finalized `manifest.version` into `/service-worker.js` without making the manifest hash depend on the service-worker hash.

---

## 10. Migration Checklist

- [ ] If you import public types from `@domstack/static`, update those imports to `@domstack/static/types.js`.
- [ ] If you rely on BrowserSync-specific dev-server behavior, test watch mode with `@domstack/sync`.
- [ ] If you rely on the bundled default layout, make sure pages and child layouts return HTML strings or `fragtml` template results, not Preact or HTM VNodes.
- [ ] If any layout module already exports a named `vars` value, confirm it should now act as layout defaults.
- [ ] If you want to keep the v11 Preact default layout, eject on v11 before upgrading to v12.
- [ ] If your ejected layout or server-side pages still import `htm/preact`, `preact`, or `preact-render-to-string`, keep those dependencies in your own `package.json`.
- [ ] If you want your ejected server-side layout to match the v12 default, migrate its templates to `fragtml` and install `fragtml`.
- [ ] If you use `.jsx` or `.tsx` browser clients, add an `esbuild.settings` file that configures your JSX runtime.
- [ ] If you use `domstack --target` or `domstack -t`, move that target list to `esbuild.settings.*`.
- [ ] If you use Preact browser clients, keep `preact` in your project dependencies.
- [ ] If you directly consume mine.css or ejected DOMStack's defaults, read the mine.css v11 migration guide.
- [ ] In direct or ejected stylesheets, replace `@import 'mine.css/dist/mine.css'` with `@import 'mine.css'` and keep optional sidecars explicit.
- [ ] In direct or ejected clients, remove `toggleTheme()`, theme-switcher imports, persisted theme state, theme controls, and light/dark mode classes.
- [ ] Add `<meta name="color-scheme" content="light dark">` to custom root layouts that use mine.css and use `prefers-color-scheme` for dark styles.
- [ ] If desired, organize custom global, layout, and page rules in their corresponding optional `domstack.*` layers.
- [ ] In ejected stylesheets, load light and dark syntax-highlighting themes with matching `prefers-color-scheme` behavior.
- [ ] If installing mine.css directly, confirm the environment uses Node.js 22+ and npm 10+ and target browsers support native CSS nesting.
- [ ] Visually check mine.css surfaces that the project directly customizes.
