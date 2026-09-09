---
layout: docs
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
    --watch, -w           build, watch and serve the site build
    --watch-only          watch and build the src folder without serving
    --serve               build once and serve the destination directory without watching
    --port                port for --serve (default: 3000)
    --copy                path to directories to copy into dist; can be used multiple times
    --help, -h            show help
    --version, -v         show version information
domstack (v12.0.0)
```

`domstack` builds a `src` directory into a `dest` directory (default: `public`).

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
  Create a default client-side JavaScript file at `globals/global.client.js`
4.
  Add the necessary dependencies to your package.json:
   - mine.css
   - fragtml
   - highlight.js

It is recommended to eject early in your project so that you can customize the root layout as you see fit, and decouple yourself from potential unwanted changes in the default layout as new versions of DOMStack are released.

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
