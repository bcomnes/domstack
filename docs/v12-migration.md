# Migration Guide: domstack v12

This guide covers breaking and notable changes when moving from domstack v11 to v12.

If you are migrating from `top-bun`, first follow the historical v11 guide at [v11-migration.md](v11-migration.md).
Then apply the v12 changes below.

## Table of Contents

1. [Type exports moved to `@domstack/static/types.js`](#1-type-exports-moved-to-domstackstatictypesjs)
2. [Default Layout Uses fragtml](#2-default-layout-uses-fragtml)
3. [Keep Layout Dependencies Explicit](#3-keep-layout-dependencies-explicit)
4. [JSX Runtime Is Opt-In](#4-jsx-runtime-is-opt-in)
5. [Migration Checklist](#5-migration-checklist)

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

## 2. Default Layout Uses fragtml

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

## 3. Keep Layout Dependencies Explicit

DOMStack only installs dependencies for its bundled defaults.
Your project is responsible for any packages imported by pages, layouts, globals, or browser clients.

If your ejected layout or server-side pages import `htm/preact`, `preact`, or `preact-render-to-string`, keep those packages in your own `package.json`.
If you migrate those server-side templates to `fragtml`, replace those dependencies with `fragtml`.

---

## 4. JSX Runtime Is Opt-In

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

## 5. Migration Checklist

- [ ] If you import public types from `@domstack/static`, update those imports to `@domstack/static/types.js`.
- [ ] If you rely on the bundled default layout, make sure pages and child layouts return HTML strings or `fragtml` template results, not Preact or HTM VNodes.
- [ ] If you want to keep the v11 Preact default layout, eject on v11 before upgrading to v12.
- [ ] If your ejected layout or server-side pages still import `htm/preact`, `preact`, or `preact-render-to-string`, keep those dependencies in your own `package.json`.
- [ ] If you want your ejected server-side layout to match the v12 default, migrate its templates to `fragtml` and install `fragtml`.
- [ ] If you use `.jsx` or `.tsx` browser clients, add an `esbuild.settings` file that configures your JSX runtime.
- [ ] If you use Preact browser clients, keep `preact` in your project dependencies.
