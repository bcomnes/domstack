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
7. [CLI `--target` moved to `esbuild.settings.*`](#7-cli---target-moved-to-esbuildsettings)
8. [Static Cache Manifest and Service Worker Preview](#8-static-cache-manifest-and-service-worker-preview)
9. [Migration Checklist](#9-migration-checklist)

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

## 7. CLI `--target` moved to `esbuild.settings.*`

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

## 8. Static Cache Manifest and Service Worker Preview

v12 adds an unstable-preview manifest pipeline for static caching and first-class site service-worker builds.

These APIs are preview APIs.
Their names, option shapes, manifest schema, generated output, and runtime semantics may change outside of a major version while they are validated with real PWA use cases.
Pin `@domstack/static` to an exact version if you rely on this contract.

### Public manifest writing is opt-in

The manifest pipeline can run without writing a public `domstack-manifest.json` file.
This is useful when your app only needs the finalized manifest in a build hook to inject service-worker policy.

Write the standard public manifest from the CLI with:

```sh
domstack --domstackManifest
```

Or write it from programmatic builds with:

```js
const site = new DomStack('src', 'public', {
  domstackManifest: true,
})
```

Use the object form when you also need filters, manifest vars, root policy, or hooks:

```js
const site = new DomStack('src', 'public', {
  domstackManifest: {
    write: true,
    exclude: ['blog/**', '**/*.map'],
    manifestVars: ['offline', 'precache'],
    policy: {
      offlineFallbackUrl: '/offline/',
    },
  },
})
```

If `domstackManifest` is unset, Domstack skips the manifest pipeline unless a `domstack-manifest.settings.*` file exists.
A settings file enables the pipeline, returns `results.domstackManifest`, and runs manifest hooks, but does not write a public JSON file unless writing is explicitly enabled.

### Add manifest settings when you need cache policy

Apps can add one `domstack-manifest.settings.*` file anywhere under `src`:

```txt
domstack-manifest.settings.js
domstack-manifest.settings.mjs
domstack-manifest.settings.cjs
domstack-manifest.settings.ts
domstack-manifest.settings.mts
domstack-manifest.settings.cts
```

Use `manifestVars` to explicitly expose selected page, layout, global, or default vars on manifest entries.
Use `policy` for root-level application policy.
Use `includeEntry(entry)` and `exclude` to filter final public output entries.

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

### Prefer manifest hooks over runtime manifest fetches

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

This avoids shipping a runtime manifest file just so a service worker can discover the build output list.
If you intentionally need a public custom artifact, write it from the hook with `context.writeFile()`.

### Add one site service worker when needed

Domstack reserves one site service-worker source filename:

```txt
service-worker.js
service-worker.mjs
service-worker.cjs
service-worker.ts
service-worker.mts
service-worker.cts
```

The source may live anywhere under `src`, but only one is allowed.
Domstack bundles it to a stable root output path:

```txt
/service-worker.js
```

Domstack does not register the service worker for you.
Your app owns registration timing, update prompts, local-development opt-outs, reset/recovery behavior, route filtering, offline fallback behavior, and runtime cache policy.

The service worker can read Domstack's build-time browser defines:

| Define | Value |
| --- | --- |
| `process.env.DOMSTACK_MANIFEST_URL` | Standard public URL for the built-in manifest, `/domstack-manifest.json` |
| `process.env.DOMSTACK_MANIFEST_VERSION` | Finalized manifest version in `/service-worker.js`; `""` in other bundles |
| `process.env.DOMSTACK_MANIFEST_ENABLED` | `"true"` for one-shot builds with an enabled manifest pipeline, `"false"` when disabled or in watch mode |
| `process.env.DOMSTACK_SERVICE_WORKER_URL` | Public URL of the site service worker, usually `/service-worker.js`, or `""` when no service worker is present |
| `process.env.DOMSTACK_SERVICE_WORKER_SCOPE` | Registration scope for the site service worker, usually `/`, or `""` when no service worker is present |

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

## 9. Migration Checklist

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
