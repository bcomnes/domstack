---
layout: docs
handlebars: false
---

<a id="assets-and-settings-reference"></a>

# Assets

DOMStack copies ordinary files and bundles browser JavaScript and CSS alongside your pages.
Use global assets to share code and styles across the site, and settings modules to customize the build tools.

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

## Global Assets

There are a few important and optional global files that can live anywhere in the `src` directory.
Global browser assets preserve their source-relative directory when built into `dest`.
For example, `src/assets/global.css` produces an output such as `dest/assets/global-[hash].css`.
Build-time files such as `global.vars.ts`, `esbuild.settings.ts`, and `markdown-it.settings.ts` are consumed by DOMStack and are not emitted.

Only one file may match each global filename pattern.
When DOMStack discovers a duplicate, it keeps the first file it found, skips the duplicate, and reports a warning.
Define each global file once rather than relying on discovery order.

> [!NOTE]
> Wherever this section uses `.ts`, you can also use `.js`.
Type checking is supported in both file types.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions.

<a id="globalvarsts"></a>

### `global.vars.ts`

The `global.vars.ts` file should default-export a [variable provider](../../docs/pages/#variable-providers).
The variables in this file are available to all pages, unless the page sets a variable with the same key, taking a higher precedence.

```typescript
export default {
  siteName: 'The name of my website',
  authorName: 'Mr. Wallace'
}
```

#### `browser` variable

`global.vars.ts` can uniquely export a [`browser` variable provider](../../docs/pages/#variable-providers).
These variables are made available in all client bundles.

```typescript
export const browser = {
  'process.env.TRANSPORT': 'http',
  'process.env.HOST': 'localhost'
}
```

The exported object is passed to esbuild's [`define`](https://esbuild.github.io/api/#define) options and is available to every js bundle.
Domstack also reserves `process.env.DOMSTACK_MANIFEST_URL`,
`process.env.DOMSTACK_MANIFEST_VERSION`, `process.env.DOMSTACK_MANIFEST_ENABLED`,
`process.env.DOMSTACK_SERVICE_WORKER_URL`, and `process.env.DOMSTACK_SERVICE_WORKER_SCOPE` for generated build facts.

> [!WARNING]
> Setting `define` in [`esbuild.settings.ts`](../../docs/assets/#esbuildsettingsts) while also using the `browser` export will throw an error.
Use one or the other.

<a id="globalclientts"></a>

### `global.client.ts`

This is a script bundle that is included on every page.
It provides an easy way to inject analytics, or other small scripts that every page should have.
Try to minimize what you put in here.

> [!NOTE]
> Use `global.client.tsx` when the global client bundle contains JSX.
You can also use `global.client.jsx`.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions and [`.tsx` client bundles](../../docs/pages/#tsx) for JSX configuration.

```typescript
console.log('I run on every page in the site!')
```

<a id="globalcss"></a>

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

<a id="esbuildsettingsts"></a>

### `esbuild.settings.ts`

This is an optional file you can create anywhere.
It should export a default sync or async function that accepts a single argument (the esbuild settings object generated by domstack) and returns a modified build object.
Use this to customize the esbuild settings directly.

Important esbuild settings you may want to set here are:

- [target](https://esbuild.github.io/api/#target) - Set the `target` to make `esbuild` run a few small transforms on your CSS and JS code.
- [jsx](https://esbuild.github.io/api/#jsx) - Configure how esbuild transforms JSX and TSX.
- [jsxImportSource](https://esbuild.github.io/api/#jsx-import-source) - Set this when using an automatic JSX runtime such as React or Preact.
- [define](https://esbuild.github.io/api/#define) - Define compile-time constants for JS bundles.
  Setting `define` here conflicts with the [`browser` export](../../docs/assets/#browser-variable) in `global.vars.ts` and throws an error if both are set.

> [!WARNING]
> An invalid esbuild override can break DOMStack's browser build.
Preserve DOMStack's required build options unless you intentionally replace their behavior.

Here is an example of using this file to polyfill Node.js built-ins in the browser bundle:

```typescript
import { polyfillNode } from 'esbuild-plugin-polyfill-node'
// BuildOptions re-exported from esbuild
import type { BuildOptions } from '@domstack/static/types.js'

const esbuildSettingsOverride = async (esbuildSettings: BuildOptions): Promise<BuildOptions> => {
  esbuildSettings.plugins = [polyfillNode()]
  return esbuildSettings
}

export default esbuildSettingsOverride
```

#### Default build behavior

DOMStack passes its complete default `BuildOptions` into this function.
The default browser build:

- Bundles ESM with code splitting enabled
- Emits source maps and an esbuild metafile
- Preserves source-relative directories through `outbase: src`
- Uses `[dir]/[name]-[hash]` for production entry files and stable `[dir]/[name]` filenames in watch mode
- Writes shared chunks to `chunks/[ext]/[name]-[hash]`
- Does not configure a JSX runtime

Default asset loaders are:

| Loader | Extensions | Behavior |
|---|---|---|
| `dataurl` | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.avif` | Embeds the imported asset in its bundle |
| `file` | `.ico`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.otf` | Emits a separate file and returns its URL |

> [!NOTE]
> Images imported by a client bundle are embedded regardless of their size by default.
Use the `file` loader when large images should remain separate files.

The function's return value becomes the effective esbuild configuration.
Preserve DOMStack's build wiring, including `entryPoints`, `outdir`, and `outbase`, unless you intentionally replace that behavior.
Spread nested options such as `loader` when adding entries because replacing the object discards its existing defaults.
DOMStack preserves its reserved `define` values after the override runs.

These options also form the basis of the [service-worker](../../docs/workers/#service-workers) build.
DOMStack replaces the service-worker entry point and filename and disables code splitting, while options such as plugins, loaders, `target`, and JSX configuration carry over.

You can return a shallow copy that modifies the defaults when you only need a small change.
For example, this keeps DOMStack's default asset loaders and adds a custom loader for `.wasm` files:

```typescript
import type { BuildOptions } from '@domstack/static/types.js'

const esbuildSettingsOverride = async (esbuildSettings: BuildOptions): Promise<BuildOptions> => {
  return {
    ...esbuildSettings,
    loader: {
      ...esbuildSettings.loader,
      '.wasm': 'file',
    },
  }
}

export default esbuildSettingsOverride
```

If you want full control, reset DOMStack's convenience defaults back to esbuild's defaults while preserving the required DOMStack build wiring (`entryPoints`, `outdir`, `outbase`, etc.).
From there, define only the settings you want:

```typescript
import type { BuildOptions } from '@domstack/static/types.js'

const esbuildSettingsOverride = async (esbuildSettings: BuildOptions): Promise<BuildOptions> => {
  return {
    ...esbuildSettings,
    jsx: undefined,
    jsxImportSource: undefined,
    loader: {
      '.png': 'file',
      '.svg': 'text',
    },
  }
}

export default esbuildSettingsOverride
```


<a id="markdown-itsettingsts"></a>

### `markdown-it.settings.ts`

This is an optional file you can create anywhere.
It should export a default sync or async function that accepts a single argument (the markdown-it instance configured by domstack) and returns a modified markdown-it instance.
Use this to add custom markdown-it plugins or modify the parser configuration.
Here are some examples:

```typescript
import markdownItContainer from 'markdown-it-container'
import markdownItPlantuml from 'markdown-it-plantuml'
import type { MarkdownIt } from 'markdown-it'

const markdownItSettingsOverride = async (md: MarkdownIt) => {
  // Add custom plugins
  md.use(markdownItContainer, 'spoiler', {
    validate: (params: string) => {
      return params.trim().match(/^spoiler\s+(.*)$/) !== null
    },
    render: (tokens: any[], idx: number) => {
      const m = tokens[idx].info.trim().match(/^spoiler\s+(.*)$/)
      if (tokens[idx].nesting === 1) {
        return '<details><summary>' + md.utils.escapeHtml(m[1]) + '</summary>\n'
      } else {
        return '</details>\n'
      }
    }
  })

  md.use(markdownItPlantuml)

  return md
}

export default markdownItSettingsOverride
```

```typescript
import markdownIt, { MarkdownIt } from 'markdown-it'
import myCustomPlugin from './my-custom-plugin'

const markdownItSettingsOverride = async (md: MarkdownIt) => {
  // Create a new instance with different settings
  const newMd = markdownIt({
    html: false,        // Disable HTML tags in source
    breaks: true,       // Convert \n to <br>
    linkify: false,     // Disable auto-linking
  })

  // Add only the plugins you want
  newMd.use(myCustomPlugin)

  return newMd
}

export default markdownItSettingsOverride
```

By default, DOMStack ships with the following markdown-it plugins enabled:

- [markdown-it](https://github.com/markdown-it/markdown-it)
- [markdown-it-footnote](https://github.com/markdown-it/markdown-it-footnote)
- [markdown-it-highlightjs](https://github.com/valeriangalliat/markdown-it-highlightjs)
- [markdown-it-emoji](https://github.com/markdown-it/markdown-it-emoji)
- [markdown-it-sub](https://github.com/markdown-it/markdown-it-sub)
- [markdown-it-sup](https://github.com/markdown-it/markdown-it-sup)
- [markdown-it-deflist](https://github.com/markdown-it/markdown-it-deflist)
- [markdown-it-ins](https://github.com/markdown-it/markdown-it-ins)
- [markdown-it-mark](https://github.com/markdown-it/markdown-it-mark)
- [markdown-it-abbr](https://github.com/markdown-it/markdown-it-abbr)
- [markdown-it-task-lists](https://github.com/revin/markdown-it-task-lists)
- [markdown-it-github-alerts](https://www.npmjs.com/package/markdown-it-github-alerts)
- [markdown-it-anchor](https://github.com/valeriangalliat/markdown-it-anchor)
- [markdown-it-attrs](https://github.com/arve0/markdown-it-attrs)
- [markdown-it-table-of-contents](https://github.com/cmaas/markdown-it-table-of-contents)

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
