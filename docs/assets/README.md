---
layout: docs
docsOrder: 50
handlebars: false
---

# Static assets

DOMStack copies static assets and explicitly included directories into your site without bundling or rendering them.
Browser JavaScript and CSS are separate build inputs: see [Global bundles](../global-bundles/), [page assets](../pages/#page-styles), and [layout assets](../layouts/#layout-styles).
Build-tool configuration and site-wide variables are documented separately in [Settings](../settings/).

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
