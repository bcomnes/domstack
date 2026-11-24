---
layout: docs
docsOrder: 10
handlebars: false
---

# CLI

Use `domstack` (or its shorter alias, `dom`) to build a site, watch for changes, or preview production output.
Use `domstack eject` to extract the bundled defaults for customization.

DOMStack runs on [Node.js](https://nodejs.org).
Install it as a development dependency in your project's `package.json` so everyone working on the site uses the same version.

## Table of Contents

[[toc]]

## Usage

| Command | Behavior |
| --- | --- |
| `domstack` or `domstack build` | Build the site. |
| `domstack watch` | Build, watch for changes, and serve with live reload. |
| `domstack serve` | Build once, then serve production output without watching or live reload. |
| `domstack sessions [id]` | Find your running watch sessions and their preview URLs. |
| `domstack eject` | Extract the default layout, global styles, and client files into the source directory and update dependencies in `package.json`. |
| `domstack help [command]` | Show root or command-specific help. |

When using an explicit command, put the command before its options, as in `domstack watch --src site`, not `domstack --src site watch`.

## `domstack build`

Use `domstack build` to build your site without starting a server.
By default, it reads from `src` and writes to `public`.
Running `domstack` with no command does the same thing.

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
| `--no-clean` | Preserve existing destination contents before a full build, including with `--replace-watch`. |
| `--domstackManifest` | Write the DOMStack manifest to disk. |
| `--copy <path>` | Copy an additional directory into the destination; repeat for multiple directories. |
| `--verbose` | Show debug logs, including individual copy operations. |
| `--replace-watch` | [Stop watching and build once](#stop-watching-and-build-once) (macOS and Linux). |
| `--help`, `-h` | Show build help; on bare `domstack`, show the command list and default build options. |
| `--version`, `-v` | Show the installed version. |

Normal output includes the build tree and a build summary.
Use `--verbose` to include debug logs and individual copy operations.
Build failures retain their full diagnostics at either verbosity level.

### Build while watch is running

On macOS and Linux, if a watcher is already using the same source and output folders, `domstack build` lets that watcher handle the build:

```sh
# In the first terminal:
domstack watch --src website --dest public

# In the second terminal:
domstack build --src website --dest public
```

The command waits for the active build and any changes already queued by the watcher. If there's no pending work, it exits without rebuilding. An unresolved watch build failure is reported as an error.
The watcher keeps running with its own settings, and detailed logs stay in the first terminal. This also works with `watch --no-serve`.
Static file copies run separately, and changes the watcher hasn't seen yet aren't part of the request. For a fresh build, use [`--replace-watch`](#stop-watching-and-build-once).

If a different site is already writing to that output folder, choose another folder or stop the other watch session first.
Output folders must not be inside one another when builds are running at the same time.

### Stop watching and build once

On macOS and Linux, use `--replace-watch` when you want to end the watch session and run a fresh build, for example with different build options.
DOMStack stops only the watcher for the same source and output folders and waits for it to finish writing.

Full builds delete everything in the output folder before rebuilding, including files you put there yourself, while preserving the folder itself.
Use `--no-clean` to retain existing contents, including when replacing a watcher.

```sh
domstack build --replace-watch --src website --dest public
```

If DOMStack can't stop the watcher, it leaves the output folder alone.
If the folder isn't in use, `--replace-watch` runs a normal build with the same cleanup behavior.

## `domstack watch`

Run `domstack watch` while you edit your site.
Open the site URL printed in your terminal; DOMStack rebuilds on changes and refreshes the browser for you using [`@domstack/sync`][domstack-sync].
Press Ctrl+C in that terminal to stop.
Use `--no-serve` if you want automatic builds without a preview server.

```sh
domstack watch
domstack watch --src site --dest public --port 8080
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
| `--port <port>` | Prefer this site port when serving (default: `3000`). |
| `--help`, `-h` | Show watch help. |
| `--version`, `-v` | Show the installed version. |

### Watch more than one site

Run each watcher in its own terminal and give each site a separate output folder.
You don't have to pick a different port for each watcher: if the requested port is busy, DOMStack picks a free one and prints the URL to open.
Use [`domstack sessions`](#domstack-sessions) to find those URLs again.

## `domstack sessions`

Not sure which port a site is using, or which projects you left running?
Run `domstack sessions` from any directory to see your active watchers on this machine, including ones started with `--no-serve`.
Pass a session ID from the list to see details for that watcher.

```sh
domstack sessions
domstack sessions SESSION_ID
```

For scripts, add `--json` to get an array of sessions or a single object when looking up an ID.
The list is empty when nothing is running, and a lookup for a session that isn't running exits with an error.
If you set `DOMSTACK_SESSION_DIR`, use the same value when starting and listing watchers.

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
domstack eject --css tailwind --framework preact
domstack eject --css tailwind --framework react --language ts
domstack eject --css none --src website
```

| Option | Description |
| --- | --- |
| `--src <path>`, `-s <path>` | Source directory to receive the defaults (default: `src`). |
| `--language <language>` | Eject `js` (default) or `ts` files. |
| `--css <preset>` | Global CSS preset: `mine` (default), `tailwind`, or `none`. |

| `--framework <framework>` | JSX integration: `none` (default), `preact`, or `react`. |
| `--yes` | Skip confirmation before writing files and updating dependencies. |
| `--help`, `-h` | Show eject help. |
| `--version`, `-v` | Show the installed version. |

Without `--yes`, eject asks for confirmation before writing files or updating dependencies.
Eject overwrites its default layout, global CSS, and client target files, so review or back up existing customizations before proceeding.
Existing dependencies and settings are not removed when switching presets.
When a preset needs esbuild settings, eject refuses conflicting settings anywhere under the source directory before changing any files or package metadata.
An identical generated settings file at the expected path can be reused; other locations or extensions must be reconciled manually to avoid duplicate settings.
Plain eject does not generate or change settings.

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
The CSS preset is independent of the selected language.
JavaScript remains the default (`--language js`), with `.js` files in module packages and `.mjs` files otherwise.
Only `ts` and `js` are accepted language values.

DOMStack maintains one canonical TypeScript root layout and generates its JavaScript counterpart at build and release time.
Both files are published; the runtime loads JavaScript directly without a custom loader, and eject copies the selected language rather than compiling it.
The TypeScript output uses the public type-only `@domstack/static/types.js` entry instead of DOMStack's private `#types` alias.
Keep `@domstack/static` installed for those types; no runtime type import or separate TypeScript compilation step is needed.
The client is currently comment-only, but receives a `.ts` extension when TypeScript is selected.

### CSS and framework presets

`--css mine` copies the bundled `default.style.css` and adds `mine.css`, `highlight.js`, and `fragtml` as dependencies.
This is the default and preserves the behavior of plain `domstack eject`.

`--css tailwind` writes `@import "tailwindcss" source("../");` to `globals/global.css` and adds `esbuild-plugin-tailwindcss` as a development dependency.
The source path is relative to the generated CSS file, so it scans your source directory even with a custom `--src`.
It does not add `mine.css` or `highlight.js`.

`--css none` writes a comment-only `globals/global.css` to suppress bundled global styling without adding CSS dependencies.
All presets add `fragtml`, which the ejected root layout requires.

`--framework preact` adds `preact`; `--framework react` adds `react` and `react-dom`.
React with `--language ts` also adds `@types/react` and `@types/react-dom` as development dependencies.
Both frameworks configure esbuild's automatic JSX transform and the matching JSX import source; they do not generate sample components or a TypeScript configuration.

Eject generates `globals/esbuild.settings.js` only when selecting a framework or Tailwind.
The settings use `.ts` with `--language ts`, or `.mjs`/`.mts` for packages without `"type": "module"`.
The Tailwind integration appends its plugin without dropping other build plugins.
Eject updates `package.json` but does not install packages or update your lockfile; run your package manager's install command afterward.

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
For example, `domstack --serve --port 4000` and `domstack --watch --port 4000` are valid, but `domstack --eject --dest public` is rejected.
Mode flags are mutually exclusive, including `--watch` together with `--watch-only`.
Legacy mode flags are not accepted on explicit commands, so use `domstack watch`, not `domstack build --watch`.

[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
