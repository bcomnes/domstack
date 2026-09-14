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

## Output conflicts

Each output file must have one producer across pages, generated pages, templates, static files, copied directories, esbuild bundles, service workers, and generated metadata.
This includes page `workers.json` files, the optional `domstack-manifest.json`, and files written through a manifest hook's `writeFile` helper.
Two templates cannot emit the same path, and a single template cannot repeat an output in an array or async iterator.
Repeated identical reporting records within one batch are deduplicated; they are not additional writes.
File-versus-directory conflicts such as `feed` and `feed/index.xml` are also rejected.
Output separators and dot segments are normalized, and case aliases are checked using the destination filesystem's case behavior.

One-shot builds claim outputs before writing them, so a conflicting second producer cannot overwrite the first.
Earlier successful build steps may remain in the destination after a later failure; the build is not rolled back.
Manifest hooks can read files they just wrote through `writeFile` from their supplied `dest`.
Watch rebuilds retain ownership for untouched producers, revalidate page outputs before promotion, and release obsolete paths after successful replacement or removal.
In a successfully started watch session, a failed conflict check retains the previous successful outputs and ownership, so fixing the source can recover without restarting watch mode.
Initial copy or esbuild failures abort startup and require starting watch again; initial page failures are logged and can recover within the session.
Full watch rebuilds replace the complete ownership map rather than accumulating historical paths.

Page phases and full watch builds use unique stages on the destination filesystem, and copied sources are isolated before publication.
Staging requires additional disk space.
Publication is not an atomic filesystem transaction: an I/O failure during the final copy can still leave partially updated files.
The registry covers DOMStack-managed writers, not arbitrary filesystem writes performed directly by user code or esbuild plugins.
Manifest hooks should use their supplied `writeFile` helper to participate in conflict detection.
Identifiable esbuild entry collisions use the same conflict error; native plugin or shared-chunk collisions that cannot be attributed to two sources retain esbuild's diagnostic.
Concurrent builds use independent stages, but separate DOMStack instances should not publish different sites to the same destination concurrently.

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
> DOMStack rejects conflicting output paths with `DOM_STACK_ERROR_OUTPUT_CONFLICT`.
The error identifies the destination-relative path and both producers, including files from different `--copy` directories.
Rename or exclude one input instead of relying on copy order to select a winner.

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
