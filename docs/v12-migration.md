# Migration Guide: domstack v12

This guide covers breaking and notable changes when moving from domstack v11 to v12.

If you are migrating from `top-bun`, first follow the historical v11 guide at [v11-migration.md](v11-migration.md).
Then apply the v12 changes below.

## Table of Contents

1. [Type exports moved to `@domstack/static/types.js`](#1-type-exports-moved-to-domstackstatictypesjs)
2. [Default Layout Uses fragtml](#2-default-layout-uses-fragtml)
3. [Default Dependencies Changed](#3-default-dependencies-changed)
4. [JSX Runtime Is Opt-In](#4-jsx-runtime-is-opt-in)
5. [Preact Examples Stay Preact](#5-preact-examples-stay-preact)
6. [Development Server Uses @domstack/sync](#6-development-server-uses-domstacksync)
7. [Migration Checklist](#7-migration-checklist)

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

If you rely on the bundled default layout, no action is required.
If you previously ejected the default layout and want the v12 default style, update your layout imports and rendering code from Preact/HTM to `fragtml`.

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

## 3. Default Dependencies Changed

The default template no longer includes Preact, HTM, or `preact-render-to-string`.

When you run `domstack --eject`, domstack adds:

- `mine.css`
- `fragtml`
- `highlight.js`

It does not add:

- `preact`
- `htm`
- `preact-render-to-string`

If your project uses any of those packages directly, keep them in your own `package.json`.

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

## 5. Preact Examples Stay Preact

Examples that actually mount Preact in the browser still use Preact.
Examples that only needed server-side HTML rendering now use `fragtml`.

This means Preact remains a good opt-in client runtime.
It is no longer the default server-side layout dependency.

---

## 6. Development Server Uses @domstack/sync

Watch/serve mode now uses [`@domstack/sync`](https://www.npmjs.com/package/@domstack/sync) for the local development server.

This provides live reload, CSS injection, ghost mode, and the UI panel.
If you were relying on BrowserSync-specific behavior or output, update your expectations around logs, access URLs, and reload handling.

---

## 7. Migration Checklist

- [ ] If you import public types from `@domstack/static`, update those imports to `@domstack/static/types.js`.
- [ ] If you use an ejected default layout, update it to `fragtml` or keep your existing layout dependencies explicitly.
- [ ] If you use `htm/preact` or `preact-render-to-string` in server-side layouts/pages, either keep those dependencies or migrate that code to `fragtml`.
- [ ] If you use `.jsx` or `.tsx` browser clients, add an `esbuild.settings` file that configures your JSX runtime.
- [ ] If you use Preact browser clients, keep `preact` in your project dependencies.
- [ ] If you rely on BrowserSync-specific dev-server behavior, test watch mode with `@domstack/sync`.
