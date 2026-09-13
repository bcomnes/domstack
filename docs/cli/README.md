---
layout: docs
docsOrder: 10
handlebars: false
---

# CLI

Use `domstack` (or its shorter alias, `dom`) to build a site, watch for changes, or preview production output.
The options below control source and destination directories, asset copying, and the development server.

## Table of Contents

[[toc]]

## Usage

```console
$ domstack --help
Usage: domstack [options]

    Example: domstack --src website --dest public

    --src, -s             path to source directory (default: "src")
    --dest, -d            path to build destination directory (default: "public")
    --ignore, -i          comma separated gitignore style ignore string
    --drafts              Build draft pages with the `.draft.{md,js,ts,html}` page suffix.
    --noEsbuildMeta       skip writing the esbuild metafile to disk
    --domstackManifest    write the domstack manifest to disk
    --eject, -e           eject the DOMStack default layout, style and client into the src flag directory
    --language            language for --eject: ts or js (default: js)
    --yes                 skip confirmation for --eject
    --watch, -w           build, watch and serve the site build
    --watch-only          watch and build the src folder without serving
    --verbose             show debug logs, including the build tree and individual copy operations
    --serve               build once and serve the destination directory without watching
    --port                port for --serve (default: 3000)
    --copy                path to directories to copy into dist; can be used multiple times
    --help, -h            show help
    --version, -v         show version information
domstack (v12.0.0)
```

`domstack` builds a `src` directory into a `dest` directory (default: `public`).

Normal output summarizes builds, static asset startup, and server URLs.
Use `--verbose` to include the build tree and individual copy operations.
Build failures retain their full diagnostics at either verbosity level.

- Running `domstack` will result in a `build` by default.
- Running `domstack --watch` or `domstack -w` will build the site and start an auto-reloading development web-server that watches for changes (provided by [`@domstack/sync`][domstack-sync]).

- Running `domstack --eject` or `domstack -e` will extract the default layout, global styles, and client-side JavaScript into your source directory and add the necessary dependencies to your package.json.

`domstack` is a devtool.
It's primarily a unix `bin` written for the [Node.js](https://nodejs.org) runtime that is intended to be installed from `npm` as a `devDependency` inside a `package.json` committed to a `git` repository.
It can be used outside of this context, but it works best within it.

## Ejecting the defaults

The `--eject` (or `-e`) flag extracts DOMStack's default layout, global CSS, and client-side JavaScript into your source directory.
This allows you to fully customize these files while maintaining the same functionality.

When you run `domstack --eject`, it will:

1.
  Create a default root layout file at `layouts/root.layout.js` (or `.mjs` depending on your package.json type)
2.
  Create a default global CSS file at `globals/global.css`
3.
  Create a default client-side JavaScript file at `globals/global.client.js` (or `.mjs` depending on your package.json type)
4.
  Add the necessary dependencies to your package.json:
   - mine.css
   - fragtml
   - highlight.js

Use `domstack --eject --language ts` to write `layouts/root.layout.ts` and `globals/global.client.ts` instead.
For packages without `"type": "module"`, the TypeScript layout uses `.mts` so Node loads it as ESM without changing your package type.
The CSS and added dependencies are the same for both languages.
JavaScript remains the default (`--language js`), with `.js` files in module packages and `.mjs` files otherwise.
Only `ts` and `js` are accepted language values.

DOMStack maintains one canonical TypeScript root layout and runs it using Node's native type stripping.
JavaScript eject output is derived from that source using `node:module`'s `stripTypeScriptTypes`, not a separate template.
The TypeScript output uses the public type-only `@domstack/static/types.js` entry instead of DOMStack's private `#types` alias.
Keep `@domstack/static` installed for those types; no runtime type import or separate TypeScript compilation step is needed.
The client is currently comment-only, but receives a `.ts` extension when TypeScript is selected.

For automation, run `domstack --eject --language ts --yes --src src` to skip the confirmation prompt.
Without `--yes`, eject asks for confirmation before writing files or updating dependencies.
Eject overwrites its target files, so review or back up existing customizations before proceeding.

It is recommended to eject early in your project so that you can customize the root layout as you see fit, and decouple yourself from potential unwanted changes in the default layout as new versions of DOMStack are released.

[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
