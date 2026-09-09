---
layout: docs
handlebars: false
---

# Assets

DOMStack copies ordinary files and bundles browser JavaScript and CSS alongside your pages.
Use global assets to share code and styles across the site, [page assets](../pages/#page-styles) for one page, and [layout assets](../layouts/#layout-styles) for pages sharing a layout.
Build-tool configuration and site-wide variables are documented in [Settings](../settings/).

## Table of Contents

[[toc]]

## Static assets

All static assets in the `src` directory are copied 1:1 to the destination directory using [cpx2](https://github.com/bcomnes/cpx2).
Files ending in `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.html`, or `.md` are reserved for DOMStack processing and are not copied as static assets.

### `--copy` directories

You can specify directories to copy into your `dest` directory using the `--copy` flag.
Everything in those directories will be copied as-is into the destination, including js, css, html and markdown, preserving the internal directory structure.

> [!NOTE]
> `--copy` intentionally accepts directories, not individual files.
Place a file in a directory whose structure encodes its desired destination path.
To copy multiple directories, repeat the flag: `domstack --copy oldsite --copy archived-docs`.

> [!WARNING]
> DOMStack does not detect conflicts between copied directories and other build output.
If multiple inputs produce the same destination path, the result is undefined.

Copy folders must live **outside** of the `dest` directory.
Copy directories can be in the src directory allowing for nested builds.
In this case they are added to the ignore glob and ignored by the rest of `domstack`.

> [!NOTE]
> When using the programmatic `DomStack` constructor, `copy` entries may be relative or absolute paths.
Relative paths are resolved from the current working directory, matching the CLI `--copy` behavior, before being stored in `domstack.opts.copy` and passed to the copy build step.
>
> ```typescript
> const site = new DomStack('src', 'public', {
>   copy: ['./legacy-site', '/srv/shared-docs'],
> })
> ```

The intention of this feature is to include legacy or archived site content without asking DOMStack to process or modify it.
In general, static content should live in your primary `src` directory, but keeping older content in a separate, unprocessed directory can make it easier to merge into the final build.

For example:

```
src/...
oldsite/
├── client.js
├── hello.html
└── styles/
    └── globals.css
```

After build:

```
src/...
oldsite/...
public/
├── client.js
├── hello.html
└── styles/
    └── globals.css
```

## Global assets

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

### `global.client.ts`

This is a script bundle that is included on every page.
It provides an easy way to inject analytics, or other small scripts that every page should have.
Try to minimize what you put in here.

> [!NOTE]
> Use `global.client.tsx` when the global client bundle contains JSX.
You can also use `global.client.jsx`.
See [Supported file types](../typescript/#supported-file-types) for all available extensions and [`.tsx` client bundles](../pages/#.tsx) for JSX configuration.

```typescript
console.log('I run on every page in the site!')
```

### `global.css`

This is a global stylesheet that every page will use.
Any styles that need to be on every single page should live here.
Importing css from `npm` modules work well here.

#### Optional cascade layers

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
