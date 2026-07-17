# Migration Guide: domstack v12

This guide covers breaking and notable changes when moving from domstack v11 to v12.

If you are migrating from `top-bun`, first follow the historical v11 guide at [v11-migration.md](v11-migration.md).
Then apply the v12 changes below.

## Table of Contents

1. [Type exports moved to `@domstack/static/types.js`](#1-type-exports-moved-to-domstackstatictypesjs)
2. [Development Server Uses @domstack/sync](#2-development-server-uses-domstacksync)
3. [Default Layout Uses fragtml](#3-default-layout-uses-fragtml)
4. [Keep Layout Dependencies Explicit](#4-keep-layout-dependencies-explicit)
5. [JSX Runtime Is Opt-In](#5-jsx-runtime-is-opt-in)
6. [mine.css v11 and CSS Cascade Layers](#6-minecss-v11-and-css-cascade-layers)
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

## 4. Keep Layout Dependencies Explicit

DOMStack only installs dependencies for its bundled defaults.
Your project is responsible for any packages imported by pages, layouts, globals, or browser clients.

If your ejected layout or server-side pages import `htm/preact`, `preact`, or `preact-render-to-string`, keep those packages in your own `package.json`.
If you migrate those server-side templates to `fragtml`, replace those dependencies with `fragtml`.

---

## 5. JSX Runtime Is Opt-In

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

## 6. mine.css v11 and CSS Cascade Layers

DOMStack v12 upgrades its bundled default styles and ejected projects from mine.css v10 to v11.
This is a downstream breaking change even when your project does not import mine.css directly, because the bundled default layout uses it.
Review the complete [mine.css v11 migration guide](https://github.com/bcomnes/mine.css/blob/master/MIGRATION.md) before upgrading a customized or ejected site.

mine.css v11 is CSS-only.
The package root now resolves to the main stylesheet, and the JavaScript theme switcher is no longer published.
Replace the old deep import with the package root:

```css
@import 'mine.css';
```

Remove imports of `mine.css` or `mine.css/dist/theme-switcher.js` from JavaScript, calls to `toggleTheme()`, stored theme state, theme controls, and `.light-mode` or `.dark-mode` rules.
Add `<meta name="color-scheme" content="light dark">` to custom root layouts and use `prefers-color-scheme` for application-specific dark styles.
If you use Highlight.js, load a light theme normally and a dark theme conditionally instead of applying one dark theme in both modes.

The optional mine.css layout remains a separate import.
DOMStack's default stylesheet imports it explicitly; ejected sites must continue to do the same.

### DOMStack cascade layer order

DOMStack v12's default stylesheet establishes this low-to-high-priority author-layer order:

```css
@layer mine, domstack.global, domstack.layout, domstack.page;
```

The order reflects DOMStack's existing stylesheet scopes:

- `mine` contains mine.css framework defaults.
- `domstack.global` contains site-wide rules and syntax themes.
- `domstack.layout` contains optional mine.css layout rules and `*.layout.css` rules.
- `domstack.page` contains page-local `style.css` rules.

Declare the complete order before imports or other layer blocks in the global stylesheet.
Import mine.css normally because its distributed stylesheet already defines the `mine` layer.
Do not write `@import 'mine.css' layer(mine)`.
Optional sidecars and syntax themes are not pre-layered, so assign them to the appropriate DOMStack layer:

```css
@layer mine, domstack.global, domstack.layout, domstack.page;

@import 'mine.css';
@import 'mine.css/dist/layout.css' layer(domstack.layout);
@import 'highlight.js/styles/github.css' layer(domstack.global);
@import url('highlight.js/styles/github-dark-dimmed.css') layer(domstack.global) (prefers-color-scheme: dark);

@layer domstack.global {
  :root {
    --brand-color: rebeccapurple;
  }
}
```

Following this pattern in custom stylesheets is recommended.
Scope layout and page rules in their matching files:

```css
/* article.layout.css */
@layer domstack.layout {
  .article-shell {
    max-inline-size: 72rem;
  }
}
```

```css
/* style.css */
@layer domstack.page {
  .article-introduction {
    font-size: 1.125em;
  }
}
```

DOMStack loads the global stylesheet first, so its order declaration establishes precedence before layout and page layer blocks are encountered.
Unlayered author rules outrank every layered normal rule, so existing unlayered overrides will still win but bypass the DOMStack scope contract.
Move them into the matching layer when you want predictable global → layout → page precedence.
CSS Modules may remain unlayered when component-local precedence is intentional, or be wrapped in the appropriate scope layer when they participate in this cascade.

mine.css v11 also intentionally changes typography, forms, tables, media framing, motion, focus treatment, and the optional `.mine-layout` width.
It preserves native table display; wrap wide tables in an accessible, named, keyboard-focusable overflow region rather than restoring `display: block` on the table.
The distributed CSS uses native CSS nesting, and the package requires Node.js 22 or newer and npm 10 or newer for installation.
Visually verify representative pages in light and dark browser modes, narrow and wide viewports, reduced-motion mode, and print preview where relevant.

---

## 7. Migration Checklist

- [ ] If you import public types from `@domstack/static`, update those imports to `@domstack/static/types.js`.
- [ ] If you rely on BrowserSync-specific dev-server behavior, test watch mode with `@domstack/sync`.
- [ ] If you rely on the bundled default layout, make sure pages and child layouts return HTML strings or `fragtml` template results, not Preact or HTM VNodes.
- [ ] If you want to keep the v11 Preact default layout, eject on v11 before upgrading to v12.
- [ ] If your ejected layout or server-side pages still import `htm/preact`, `preact`, or `preact-render-to-string`, keep those dependencies in your own `package.json`.
- [ ] If you want your ejected server-side layout to match the v12 default, migrate its templates to `fragtml` and install `fragtml`.
- [ ] If you use `.jsx` or `.tsx` browser clients, add an `esbuild.settings` file that configures your JSX runtime.
- [ ] If you use Preact browser clients, keep `preact` in your project dependencies.
- [ ] Read the mine.css v11 migration guide and account for its intentional visual and browser-support changes.
- [ ] Replace `@import 'mine.css/dist/mine.css'` with `@import 'mine.css'` and keep optional sidecars explicit.
- [ ] Remove `toggleTheme()`, theme-switcher imports, persisted theme state, theme controls, and light/dark mode classes.
- [ ] Add `<meta name="color-scheme" content="light dark">` to custom root layouts and use `prefers-color-scheme` for dark styles.
- [ ] Declare `@layer mine, domstack.global, domstack.layout, domstack.page;` and scope global, layout, and page rules in their matching layers.
- [ ] Load light and dark syntax-highlighting themes with matching `prefers-color-scheme` behavior.
- [ ] Confirm the deployment and install environment uses Node.js 22+ and npm 10+ and that target browsers support native CSS nesting.
- [ ] Visually and interactively check both color schemes, keyboard focus, reduced motion, forms, wide tables, media, print, and responsive layouts.
