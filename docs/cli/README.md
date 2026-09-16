---
layout: docs
docsOrder: 10
handlebars: false
---

# CLI

Use `domstack` (or its shorter alias, `dom`) to build a site, watch for changes, or preview production output.
Use `domstack eject` to extract the bundled defaults for customization.

`domstack` is a devtool.
It's primarily a unix `bin` written for the [Node.js](https://nodejs.org) runtime that is intended to be installed from `npm` as a `devDependency` inside a `package.json` committed to a `git` repository.
It can be used outside of this context, but it works best within it.

## Table of Contents

[[toc]]

## Usage

| Command | Behavior |
| --- | --- |
| `domstack` or `domstack build` | Build once and exit. |
| `domstack watch` | Build, watch for changes, and serve with live reload. |
| `domstack serve` | Build once, then serve production output without watching or live reload. |
| `domstack eject` | Extract the default layout, global styles, and client files into the source directory and update dependencies in `package.json`. |
| `domstack help [command]` | Show root or command-specific help. |

When using an explicit command, put the command before its options, as in `domstack watch --src site`, not `domstack --src site watch`.

## `domstack build`

Build the site once and exit.
Running `domstack` without a command performs the same build, with `src` as the source directory and `public` as the destination by default.

```sh
domstack
domstack build --src website --dest public
domstack build --copy images --copy downloads
```

| Option | Description |
| --- | --- |
| `--src <path>`, `-s <path>` | Source directory (default: `src`). |
| `--dest <path>`, `-d <path>` | Build destination directory (default: `public`). |
| `--ignore <patterns>`, `-i <patterns>` | Comma-separated gitignore-style ignore patterns. |
| `--drafts` | Include draft pages with the `.draft.{md,js,ts,html}` page suffix. |
| `--noEsbuildMeta` | Skip writing the esbuild metafile to disk. |
| `--domstackManifest` | Write the DOMStack manifest to disk. |
| `--copy <path>` | Copy an additional directory into the destination; repeat for multiple directories. |
| `--verbose` | Show debug logs, including individual copy operations. |
| `--help`, `-h` | Show build help; on bare `domstack`, show the command list and default build options. |
| `--version`, `-v` | Show the installed version. |

Normal output includes the build tree and a build summary.
Use `--verbose` to include debug logs and individual copy operations.
Build failures retain their full diagnostics at either verbosity level.

## `domstack watch`

Build the site, watch for changes, and serve with live reload using [`@domstack/sync`][domstack-sync].
Use `--no-serve` when another process serves the output.
Watch mode uses stable bundle filenames rather than production hashes.

```sh
domstack watch
domstack watch --src site --dest public
domstack watch --no-serve
```

| Option | Description |
| --- | --- |
| `--src <path>`, `-s <path>` | Source directory (default: `src`). |
| `--dest <path>`, `-d <path>` | Build destination directory (default: `public`). |
| `--ignore <patterns>`, `-i <patterns>` | Comma-separated gitignore-style ignore patterns. |
| `--drafts` | Include draft pages with the `.draft.{md,js,ts,html}` page suffix. |
| `--noEsbuildMeta` | Skip writing the esbuild metafile to disk. |
| `--domstackManifest` | Accepted, but has no effect: watch mode does not finalize or write the DOMStack manifest. |
| `--copy <path>` | Copy and watch an additional directory in the destination; repeat for multiple directories. |
| `--verbose` | Show debug logs, including individual copy operations. |
| `--no-serve` | Watch and rebuild without starting a server. |
| `--help`, `-h` | Show watch help. |
| `--version`, `-v` | Show the installed version. |

Normal output includes the initial build tree, rebuild summaries, static asset startup, and server URLs.
Build failures retain their full diagnostics at either verbosity level.
`--port` is not available on this command.

## `domstack serve`

Build the site once, then serve production output without watching or live reload.
Use this command to preview the production build, including manifest-driven service-worker caching.
It always builds first; it is not a server-only command for an existing destination.

```sh
domstack serve
domstack serve --src website --dest public --port 8080
domstack serve --domstackManifest
```

| Option | Description |
| --- | --- |
| `--src <path>`, `-s <path>` | Source directory (default: `src`). |
| `--dest <path>`, `-d <path>` | Build destination directory (default: `public`). |
| `--ignore <patterns>`, `-i <patterns>` | Comma-separated gitignore-style ignore patterns. |
| `--drafts` | Include draft pages with the `.draft.{md,js,ts,html}` page suffix. |
| `--noEsbuildMeta` | Skip writing the esbuild metafile to disk. |
| `--domstackManifest` | Write the DOMStack manifest to disk. |
| `--copy <path>` | Copy an additional directory into the destination; repeat for multiple directories. |
| `--verbose` | Show debug logs, including individual copy operations. |
| `--port <number>` | Server port, an integer from `1` to `65535` (default: `3000`). |
| `--help`, `-h` | Show serve help. |
| `--version`, `-v` | Show the installed version. |

Normal output includes the build tree, a build summary, and server URLs.
Build failures retain their full diagnostics at either verbosity level.

## `domstack eject`

Extract DOMStack's default layout, global CSS, and client-side JavaScript into your source directory and add their dependencies to `package.json`.
This allows you to fully customize these files while maintaining the same functionality.

```sh
domstack eject
domstack eject --language ts
domstack eject --language ts --yes --src src
```

| Option | Description |
| --- | --- |
| `--src <path>`, `-s <path>` | Source directory to receive the defaults (default: `src`). |
| `--language <language>` | Eject `js` (default) or `ts` files. |
| `--yes` | Skip confirmation before writing files and updating dependencies. |
| `--help`, `-h` | Show eject help. |
| `--version`, `-v` | Show the installed version. |

Without `--yes`, eject asks for confirmation before writing files or updating dependencies.
Eject overwrites its target files, so review or back up existing customizations before proceeding.

### Ejecting the defaults

When you run `domstack eject`, it will:

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

Use `domstack eject --language ts` to write `layouts/root.layout.ts` and `globals/global.client.ts` instead.
For packages without `"type": "module"`, the TypeScript layout uses `.mts` so Node loads it as ESM without changing your package type.
The CSS and added dependencies are the same for both languages.
JavaScript remains the default (`--language js`), with `.js` files in module packages and `.mjs` files otherwise.
Only `ts` and `js` are accepted language values.

DOMStack maintains one canonical TypeScript root layout and generates its JavaScript counterpart at build and release time.
Both files are published; the runtime loads JavaScript directly without a custom loader, and eject copies the selected language rather than compiling it.
The TypeScript output uses the public type-only `@domstack/static/types.js` entry instead of DOMStack's private `#types` alias.
Keep `@domstack/static` installed for those types; no runtime type import or separate TypeScript compilation step is needed.
The client is currently comment-only, but receives a `.ts` extension when TypeScript is selected.

It is recommended to eject early in your project so that you can customize the root layout as you see fit, and decouple yourself from potential unwanted changes in the default layout as new versions of DOMStack are released.

## `domstack help`

Show the command list and default build options, or pass a command name to show its full help.
This command takes an optional command name and no flags.

```sh
domstack help
domstack help build
domstack help watch
domstack help serve
domstack help eject
```

`domstack help` is equivalent to `domstack --help`.
`domstack help <command>` is equivalent to `domstack <command> --help`, for example `domstack help watch` and `domstack watch --help`.

## Legacy shortcuts

Root-level mode flags remain supported for existing scripts, but prefer commands for new usage.

| Legacy shortcut | Preferred command |
| --- | --- |
| `domstack --watch` or `domstack -w` | `domstack watch` |
| `domstack --watch-only` | `domstack watch --no-serve` |
| `domstack --serve` | `domstack serve` |
| `domstack --eject` or `domstack -e` | `domstack eject` |

Legacy shortcuts use the same strict option validation as their target commands.
For example, `domstack --serve --port 4000` is valid, but `domstack --watch --port 4000` and `domstack --eject --dest public` are rejected.
Mode flags are mutually exclusive, including `--watch` together with `--watch-only`.
Legacy mode flags are not accepted on explicit commands, so use `domstack watch`, not `domstack build --watch`.

[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
