---
layout: docs
docsOrder: 60
handlebars: false
---

# Global bundles

Global client and CSS entry files are bundled with esbuild and included on every page.
Use [page bundles](../pages/#page-client-bundles) for one page and [layout bundles](../layouts/#layout-client-bundles) for pages sharing a layout.
Files copied without processing are documented in [Static assets](../assets/), while build-tool configuration belongs in [Settings](../settings/).

## Table of Contents

[[toc]]

## Global entry files

Global scripts and styles can live anywhere in the `src` directory.
Global browser assets preserve their source-relative directory when built into `dest`.
For example, `src/assets/global.css` produces an output such as `dest/assets/global-[hash].css`.

Only one file may match each global filename pattern.
When DOMStack discovers a duplicate, it keeps the first file it found, skips the duplicate, and reports a warning.
Define each global file once rather than relying on discovery order.

> [!NOTE]
> Wherever this section uses `.ts`, you can also use `.js`.
Type checking is supported in both file types.
See [Supported file types](../typescript/#supported-file-types) for all available extensions.

## Global client bundles

`global.client.ts` is a script bundle that is included on every page.
It provides an easy way to inject analytics or other small scripts that every page should have.
Try to minimize what you put in here.

> [!NOTE]
> Use `global.client.tsx` when the global client bundle contains JSX.
You can also use `global.client.jsx`.
See [Supported file types](../typescript/#supported-file-types) for all available extensions and [`.tsx` client bundles](../pages/#tsx) for JSX configuration.

```typescript
console.log('I run on every page in the site!')
```

## Global styles

`global.css` is a global stylesheet that every page will use.
Any styles that need to be on every single page should live here.
Importing CSS from `npm` modules works well here.

### Optional cascade layers

The bundled default stylesheet imports mine.css's main rules in its low-priority `mine` layer and its optional layout and syntax styles in `domstack.default`.
Normal unlayered styles in your project override those defaults, so custom stylesheets do not have to use cascade layers.

For projects that prefer explicit layers, each stylesheet can declare only its own optional scope:

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

DOMStack loads default, global, layout, and page stylesheets in that order, which gives these layers the same low-to-high precedence when they are used.
A global stylesheet does not need to enumerate the layout or page layers.
This is a recommended organization pattern, not a requirement.
