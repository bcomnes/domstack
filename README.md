# domstack
[![npm version](https://img.shields.io/npm/v/@domstack/static.svg)](https://npmjs.org/package/@domstack/static)
[![npm beta version](https://img.shields.io/npm/v/@domstack/static/beta.svg?label=beta)](https://www.npmjs.com/package/@domstack/static?activeTab=versions)
[![Actions Status](https://github.com/bcomnes/domstack/workflows/tests/badge.svg)](https://github.com/bcomnes/domstack/actions)
[![Coverage Status](https://coveralls.io/repos/github/bcomnes/domstack/badge.svg?branch=master)](https://coveralls.io/github/bcomnes/domstack?branch=master)
[![Types in JS](https://img.shields.io/badge/types_in_js-yes-brightgreen)](https://github.com/voxpelli/types-in-js)
[![Neocities][neocities-img]](https://domstack.net)

`domstack`: Cut the [🪢 gordian knot](https://en.wikipedia.org/wiki/Gordian_Knot) of modern web development and build websites with a stack of HTML, CSS, and Javascript (Typescript and JSX included). 

[DOMStack](#) provides a few project conventions around [esbuild][esbuild] ande [Node.js](https://nodejs.org/en) that lets you quickly, cleanly and easily build websites and web apps using all of your favorite technolgies without any framework specific impurities, unlocking the web platform as a freeform canvas, by simply placing some standard file types into a directory structure that represents the website. It's deceptively simple, highly efficient and very flexible and powerful.

```console
npm install @domstack/static@beta
```

> [!NOTE]
> DOMStack v12 is currently published under npm's `beta` dist-tag. Omit `@beta` to install the latest stable release.

- 🌎 [domstack docs website](https://domstack.net)
- 💬 [Discord Chat](https://discord.gg/AVTsPRGeR9)
- 📢 [v12 Migration Guide](docs/v12-migration.md)
- 📚 [fragtml docs][fragtml-docs]
- 📢 [v11 - top-bun is now domstack](docs/v11-migration.md)
- 📢 [v7 Announcement](https://bret.io/blog/2023/reintroducing-top-bun/)

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

`domstack` is a devtool. It's primarily a unix `bin` written for the [Node.js](https://nodejs.org) runtime that is intended to be installed from `npm` as a `devDependency` inside a `package.json` committed to a `git` repository.
It can be used outside of this context, but it works best within it.

## Core Concepts

`domstack` builds pages from a `src` directory into a destination directory, usually `public`. Page URLs follow the source directory structure, creating a filesystem router without separate routing configuration.

Given this source:

```text
src/
├── page.md                   # The home page
├── style.css                 # Styles scoped to the home page
├── client.ts                 # Browser code loaded by the home page
├── layouts/
│   ├── root.layout.ts        # The default layout for every page
│   └── blog.layout.ts        # An optional layout selected by page variables
├── globals/
│   ├── global.css            # Styles loaded by every page
│   ├── global.client.ts      # Browser code loaded by every page
│   └── global.vars.ts        # Variables available to every page and layout
├── about/
│   └── page.md               # The /about/ page
├── interactive/
│   ├── page.html             # The /interactive/ page
│   └── client.tsx            # Page-scoped browser UI written with JSX
└── blog/
    ├── page.ts               # The /blog/ page
    └── first-post/
        ├── README.md         # The /blog/first-post/ page
        └── diagram.svg       # A static asset colocated with the post
```

`domstack` produces output resembling the following (generated bundle hashes will vary):

```text
public/
├── index.html                # Home content rendered through root.layout.ts
├── style-ABC123.css          # Bundle built from the home page's style.css
├── client-ABC123.js          # Bundle built from the home page's client.ts
├── globals/
│   ├── global-ABC123.css     # Site-wide bundle built from global.css
│   └── global.client-ABC123.js # Site-wide bundle built from global.client.ts
├── about/
│   └── index.html            # About content rendered through root.layout.ts
├── interactive/
│   ├── index.html            # Loads the bundle built from client.tsx
│   └── client-ABC123.js      # Approximate output name for the TSX bundle
└── blog/
    ├── index.html            # Blog content rendered through the selected layout
    └── first-post/
        ├── index.html        # Post content rendered through the selected layout
        └── diagram.svg       # Copied alongside the page that uses it
```

A page directory contains a `page.md`, `page.html`, or `page.ts` file. `README.md` may be used instead of `page.md`, making the source tree browsable on GitHub.

Pages can also have colocated assets:

- `style.css` for page-specific styles
- `client.ts` or `client.tsx` for page-specific browser code
- `page.vars.ts` for page variables
- `*.worker.ts` for web workers

> [!NOTE]
> Wherever you see `.ts` being used, you can also use `.js`. Type checking is supported in both file types. See [Supported file types](#supported-file-types) for all available extensions.

Layouts wrap page content in complete HTML documents. The `root` layout is the default, while pages can select another layout through the `layout` variable. Global styles, browser code, and variables apply across the site regardless of where their files live in `src`.

Templates and other advanced features can generate additional output as needed. The following sections document each convention in detail.

`domstack` ships with sane defaults, so you can point it at a standard [markdown-documented repository](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github) and build a website with near-zero preparation.

## Examples

A collection of examples can be found in the [`./examples`](https://github.com/bcomnes/domstack/tree/master/examples) folder:

- [`basic`](https://github.com/bcomnes/domstack/tree/master/examples/basic) — A broad tour of Markdown, HTML, and TypeScript pages, nested pages and layouts, variables, styles, client bundles, and static assets.
- [`blog`](https://github.com/bcomnes/domstack/tree/master/examples/blog) — A blog with derived global data, generated archive pages, redirects, nested layouts, and feed templates.
- [`css-modules`](https://github.com/bcomnes/domstack/tree/master/examples/css-modules) — Using CSS Modules from page code alongside global and page styles.
- [`default-layout`](https://github.com/bcomnes/domstack/tree/master/examples/default-layout) — Building a Markdown site with DOMStack's built-in default layout and no custom layout.
- [`esbuild-settings`](https://github.com/bcomnes/domstack/tree/master/examples/esbuild-settings) — Customizing the browser build through `esbuild.settings`.
- [`markdown-settings`](https://github.com/bcomnes/domstack/tree/master/examples/markdown-settings) — Customizing Markdown rendering with `markdown-it.settings` and Markdown-it plugins.
- [`nested-dest`](https://github.com/bcomnes/domstack/tree/master/examples/nested-dest) — Using the project root as `src` while writing the built site to a nested `public` directory.
- [`preact-isomorphic`](https://github.com/bcomnes/domstack/tree/master/examples/preact-isomorphic) — Rendering with Preact on the server and mounting page-scoped Preact and JSX in the browser.
- [`react`](https://github.com/bcomnes/domstack/tree/master/examples/react) — Configuring React and TypeScript for a page-scoped TSX client.
- [`static-mpa-offline`](https://github.com/bcomnes/domstack/tree/master/examples/static-mpa-offline) — A static multi-page app with DOMStack manifests, an offline fallback, precaching, and custom service-worker caching policies.
- [`static-mpa-workbox-offline`](https://github.com/bcomnes/domstack/tree/master/examples/static-mpa-workbox-offline) — The offline static MPA pattern implemented with Workbox routing, strategies, and precaching.
- [`string-layouts`](https://github.com/bcomnes/domstack/tree/master/examples/string-layouts) — Writing layouts that return plain HTML strings instead of using the default renderer.
- [`tailwind`](https://github.com/bcomnes/domstack/tree/master/examples/tailwind) — Integrating Tailwind CSS through an esbuild plugin.
- [`type-stripping`](https://github.com/bcomnes/domstack/tree/master/examples/type-stripping) — Using Node.js type stripping for TypeScript pages and layouts, plus a page-scoped TSX client.
- [`uhtml-isomorphic`](https://github.com/bcomnes/domstack/tree/master/examples/uhtml-isomorphic) — Rendering with `uhtml-isomorphic` on the server and mounting or hydrating UI in the browser.
- [`worker-example`](https://github.com/bcomnes/domstack/tree/master/examples/worker-example) — Bundling and communicating with page-scoped JavaScript and TypeScript Web Workers.

To run an example:

```bash
$ git clone git@github.com:bcomnes/domstack.git
$ cd domstack
# install the root package and all example workspaces
$ npm i
# build one example workspace
$ npm --workspace @domstack/basic-example run build
```

### External examples

Here are some additional external examples of larger domstack projects.
If you have a project that uses domstack and could act as a nice example, please PR it to the list!

- [Blog Example](https://github.com/bcomnes/bret.io/) - A personal blog written with DOMStack
- [Isomorphic Static/Client App](https://github.com/hifiwi-fi/breadcrum.net/tree/master/packages/web/client) - Pages build from client templates and hydrate on load.
- [Zero-Conf Markdown Docs](https://github.com/bcomnes/deploy-to-neocities/blob/70b264bcb37fca5b21e45d6cba9265f97f6bfa6f/package.json#L38) - A npm package with markdown docs, transformed into a website without any any configuration

(Did you make a cool DOMStack website that is open source? PR it to the list!)

## Ejecting the defaults

The `--eject` (or `-e`) flag extracts DOMStack's default layout, global CSS, and client-side JavaScript into your source directory. This allows you to fully customize these files while maintaining the same functionality.

When you run `domstack --eject`, it will:

1. Create a default root layout file at `layouts/root.layout.js` (or `.mjs` depending on your package.json type)
2. Create a default global CSS file at `globals/global.css`
3. Create a default client-side JavaScript file at `globals/global.client.js`
4. Add the necessary dependencies to your package.json:
   - mine.css
   - fragtml
   - highlight.js

It is recomended to eject early in your project so that you can customize the root layout as you see fit, and de-couple yourself from potential unwanted changes in the default layout as new versions of DOMStack are released.

## Pages

Pages are named directories inside `src` with **one of** the following page files:

- `md` pages are [CommonMark](https://commonmark.org) markdown pages, with an optional [YAML](https://yaml.org) front-matter block.
- `html` pages are an inner [HTML](https://developer.mozilla.org/en-US/docs/Web/HTML) fragment that get inserted into the page layout.
- `ts` pages are [TypeScript](https://developer.mozilla.org/en-US/docs/Glossary/TypeScript) files that export a default function that resolves into an inner HTML fragment inserted into the page layout.

> [!NOTE]
> A **source-backed page** is discovered directly from a page file in `src`, rather than created by a `*.pages.ts` module. Source-backed pages exist before `global.data.ts` and [Generated Pages](#generated-pages) run.

Variables are available in all pages. `md` and `html` pages support variable access via [handlebars][hb] template blocks. `ts` pages receive variables as part of the argument passed to them. See the [Variables](#variables) section for more info.

Pages can define a special variable called [`layout`](#layouts) that determines which layout the page is rendered into.

Because pages are just directories, they nest and structure naturally as a filesystem router. Directories in the `src` folder that lack one of these special page files can exist along side page directories and can be used to store co-located code or static assets without conflict.

### `md` pages

A `md` page looks like this on the filesystem:

```bash
src/page-name/page.md
# or
src/page-name/README.md
# or
src/page-name/loose-md.md
```

- `md` pages have three types: a `page.md`, a `README.md`, or a loose `whatever-name-you-want.md` file.
- `page.md` and `README.md` files transform to an `index.html` at the same path. When both exist in the same directory, `page.md` takes precedence over `README.md`. `whatever-name-you-want.md` loose markdown files transform into `whatever-name-you-want.html` files at the same path in the `dest` directory.
- `md` pages can have [YAML](https://yaml.org/) [frontmatter](https://docs.github.com/en/contributing/writing-for-github-docs/using-yaml-frontmatter), with variables that are accessible to the page layout and handlebars template blocks when building.
- You can include HTML in markdown files, so long as you adhere to the allowable markdown syntax around html tags.
- `md` pages support [handlebars][hb] template placeholders.
- You can disable `md` page [handlebars][hb] processing by setting the `handlebars` variable to `false`.
- `md` pages support many [github flavored markdown features](https://github.com/bcomnes/domstack/blob/master/lib/build-pages/page-builders/md/get-md.js#L25-L36).

An example of a `md` page:

```markdown
---
title: A title for a markdown page
favoriteColor: 'Blue'
---

Just writing about web development.

## Favorite colors

My favorite color is {{ vars.favoriteColor }}.
```

### `html` pages

A `html` page looks like this:

```bash
src/page-name/page.html
```

- `html` pages are named `page.html` inside an associated page folder.
- `html` pages are the simplest page type in `domstack`. They let you build with raw html for when you don't want that page to have access to markdown features. Some pages are better off with just raw `html`, and the rules with building `html` in a real `html` file are much more flexible than inside of a `md` file.
- `html` page variables can only be set in a `page.vars.ts` file inside the page directory.
- `html` pages support [handlebars][hb] template placeholders.
- You can disable `html` page [handlebars][hb] processing by setting the `handlebars` variable to `false`.

An example `html` page:

```html
<h2>Favorite frameworks</h2>
<ul>
  <li>React</li>
  <li>Vue</li>
  <li>Svelte</li>
  <!-- favoriteFramework defined in page.vars.ts -->
  <li>{{ vars.favoriteFramework }}</li>
</ul>
```

### `ts` pages

A `ts` page looks like this:

```bash
src/page-name/page.ts
```

> [!NOTE]
> Wherever you see `.ts` being used, you can also use `.js`. Type checking is supported in both file types. See [Supported file types](#supported-file-types) for all available extensions.

- `ts` pages consist of a named directory with a `page.ts` file that exports a default function returning the contents of the inner page.
- A `ts` page needs to `export default` a function (async or sync) that accepts a variables argument and returns a string of the inner HTML of the page, or any other type that your layout can accept.
- You can specify the return type using `PageFunction<T, U>` where `T` is the variables type and `U` is the return type (defaults to `any`).
- A `ts` page can export a [`vars` variable provider](#variable-providers) that takes highest variable precedence when rendering the page. `export vars` is similar to a `md` page's front matter.
- A `ts` page receives the standard `domstack` [Variables](#variables) set.
- There is no built-in Handlebars support in `ts` pages; however, you are free to use any template library that you can import.
- `ts` pages run in a Node.js context only.

An example TypeScript page:

```typescript
import type { PageFunction } from '@domstack/static/types.js'

export const vars = {
  favoriteCookie: 'Chocolate Chip with Sea Salt'
}

const page: PageFunction<typeof vars> = async ({
  vars
}) => {
  return /* html */`<div>
    <p>This is just some html.</p>
    <p>My favorite cookie: ${vars.favoriteCookie}</p>
  </div>`
}

export default page
```

It is recommended to use some level of template processing over raw string templates so that HTML is well-formed and variable values are properly escaped. DOMStack's default layout uses [`fragtml`][fragtml], a safe-by-default HTML tagged template library. Here is a more realistic TypeScript example that uses `fragtml` and `domstack` page introspection.


```typescript
import { html } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'
import { dirname, basename } from 'node:path'
import type { PageFunction } from '@domstack/static/types.js'

type BlogVars = {
  favoriteCake: string
}

export const vars = {
  favoriteCake: 'Chocolate Cloud Cake'
}

const blogIndex: PageFunction<BlogVars, HtmlResult> = async ({
  vars: { favoriteCake },
  pages
}) => {
  const yearPages = pages.filter(page => dirname(page.pageInfo.path) === 'blog')
  return html`<div>
    <p>I love ${favoriteCake}!!</p>
    <ul>
      ${yearPages.map(yearPage => html`
        <li>
          <a href="${yearPage.pageInfo.url}">
            ${basename(yearPage.pageInfo.path)}
          </a>
        </li>
      `)}
    </ul>
  </div>`
}

export default blogIndex
```

### Page Styles

You can create a `style.css` file in any page folder.
Page styles are loaded on just that one page.
You can import common use styles into a `style.css` page style using css [`@import`](https://developer.mozilla.org/en-US/docs/Web/CSS/@import) statements to re-use common css.
You can `@import` paths to other css files, or out of `npm` modules you have installed in your projects `node_modues` folder.
`css` page bundles are bundled using [`esbuild`][esbuild].

An example of a page `style.css` file:

```css
/* /some-page/style.css */
@import "some-npm-module/style.css";
@import "../common-styles/button.css";

.some-page-class {
  color: blue;

  & .button {
    color: purple;
  }
}
```

### Page client bundles

You can create a `client.ts` file in any page folder.
Page bundles are client-side JavaScript bundles that are loaded on that one page only.
You can import common code and modules from relative paths, or `npm` modules out of `node_modules`.
Page client bundles are bundle-split with every other client-side entry point, so shared code is loaded efficiently.
Page bundles run in a browser context only; however, they can share carefully crafted code that also runs in a Node.js or layout context.
Page bundles are built using [`esbuild`][esbuild].

An example of a page `client.ts` file:

```typescript
/* /some-page/client.ts */
import { funnyLibrary } from 'funny-library'
import { someHelper } from '../helpers/foo.ts'

await someHelper()
await funnyLibrary()
```

#### `.tsx`

Client bundles support [`.tsx`](https://www.typescriptlang.org/docs/handbook/jsx.html) through [esbuild's JSX transform](https://esbuild.github.io/content-types/#jsx).

> [!NOTE]
> Wherever you see `.tsx` being used for a client bundle, you can also use [`.jsx`](https://facebook.github.io/jsx/). Type checking is supported in both file types. See [Supported file types](#supported-file-types) for all available extensions.

> [!IMPORTANT]
> `.tsx` and `.jsx` are supported only in client bundles. JSX syntax is unavailable in page files, layouts, templates, settings, and anything else that runs in the Node.js context.

DOMStack does not include a JSX runtime by default.
Install the runtime you want and configure it with `esbuild.settings`.
[Preact][preact] is the recommended JSX runtime for DomStack because it is small, browser-focused, and works well with page-scoped client bundles.
See the [preact-isomorphic](./examples/preact-isomorphic/) and [react](./examples/react/) examples for complete projects.

To use Preact in browser TSX bundles, add it to your project and opt into Preact's automatic JSX runtime:

```console
npm install preact
```

```typescript
// src/esbuild.settings.ts
export default async function esbuildSettingsOverride (esbuildSettings) {
  esbuildSettings.jsx = 'automatic'
  esbuildSettings.jsxImportSource = 'preact'

  return esbuildSettings
}
```

If a dependency expects React, you can often swap React for `@preact/compat` with an npm package alias.
This installs `@preact/compat` into `node_modules/react`.
See [Simple TanStack Query in Preact](https://bret.io/blog/2026/simple-tanstack-query-in-preact/) for more details.

```json
{
  "dependencies": {
    "react": "npm:@preact/compat@^18.3.1"
  }
}
```

React also works if your project needs React-specific APIs or ecosystem packages.
To use React in browser TSX bundles, add React to your project and opt into React's automatic JSX runtime:

```console
npm install react react-dom
```

```typescript
// src/esbuild.settings.ts
export default async function esbuildSettingsOverride (esbuildSettings) {
  esbuildSettings.jsx = 'automatic'
  esbuildSettings.jsxImportSource = 'react'

  return esbuildSettings
}
```

### Page variable files

Each page can also have an adjacent `page.vars.ts` file that default-exports a [variable provider](#variable-providers) containing page-specific variables.

```typescript
// export an object
export default {
  my: 'vars'
}

// OR export a default function
export default () => {
  return { my: 'vars' }
}

// OR export a default async function
export default async () => {
  return { my: 'vars' }
}
```

Page variable files have higher precedence than `global.vars.ts` variables, but lower precedence than frontmatter or `vars` exports from `ts` pages. See [Variables](#variables) for the full variable cascade.

### Draft pages

A complete draft page can use the same colocated files as a published page:

```text
src/
└── blog/
    └── unpublished-post/
        ├── page.draft.md      # Draft page content
        ├── page.vars.ts       # Page-specific variables
        ├── client.ts          # Page-specific browser code
        └── style.css          # Page-specific styles
```

If you add a `.draft.{md,html,ts}` suffix to any page type, the page is considered a draft page.
Draft pages are not built by default.
If you pass the `--drafts` flag when building or watching, the draft pages will be built.
When draft pages are omitted, they are completely ignored.

Draft pages can be detected in layouts using the `page.draft === true` or `pages[n].draft === true` variable.
It is a good idea to display something indicating the page is a draft in your templates so you don't get confused when working with the `--drafts` flag.

> [!NOTE]
> Static assets colocated with draft pages are still copied when drafts are excluded because static assets are processed independently from pages.

Draft pages let you work on pages before they are ready and easily omit them from a build when deploying pages that are ready.

## Layouts

Layouts are "outer page templates" that pages get rendered into.
You can define as many as you want, and they can live anywhere in the `src` directory.

Layouts are named `${layout-name}.layout.ts` where `${layout-name}` becomes the name of the layout.
Layouts should have a unique name, and layouts with duplicate names result in a build error.

> [!NOTE]
> Wherever you see `.layout.ts` being used, you can also use `.layout.js`. Type checking is supported in both file types. See [Supported file types](#supported-file-types) for all available extensions.

Example layout file names:

```bash
src/layouts/root.layout.ts # this layout is referenced as 'root'
src/other-layouts/article.layout.ts # this layout is referenced as 'article'
```

At a minimum, your site requires a `root` layout (a file named `root.layout.ts`), though `domstack` ships a default `root` layout so defining one in your `src` directory is optional, though recommended.
Owning your own root layout will make DOMStack updates easier, and give you more control over your site.

All pages have a `layout` variable that defaults to `root`. If you set the `layout` variable to a different name, pages will build with a layout matching the name you set to that variable.

The following markdown page would be rendered using the `article` layout.

```md
---
layout: 'article'
title: 'My Article Title'
---

Thanks for reading my article
```

A page referencing a layout name that doesn't have a matching layout file will result in a build error. To reuse a common frame across multiple layouts, see [Compose nested layouts](#compose-nested-layouts).

Layouts may also export an optional [`vars` variable provider](#variable-providers) containing defaults for pages that use the layout:

```ts
export const vars = {
  showSidebar: true,
  pageType: 'article',
}
```

Layout vars are merged into the same resolved page variable cascade that pages, layouts, templates, and domstack manifest settings receive. Precedence is:

```txt
page/frontmatter vars > page.vars.* > layout vars > global.data/global.vars > domstack defaults
```

This makes layout vars useful for section-wide defaults while still letting individual pages override them.

### The default `root.layout.ts`

A layout is a `ts` file that default-exports an async or sync function implementing an outer HTML template that houses the page's inner content (`children`). Think of the frame around a picture. That's a layout. 🖼️

It is always passed a single object argument with the following entries. See [Page data and introspection](#page-data-and-introspection) for details about the `page` and `pages` entries:

- `vars`: The resolved page variable cascade, including domstack defaults, global vars/data, layout vars, page vars, and page builder vars/frontmatter. Pages can customize layouts by overriding global or layout defaults.
- `scripts`: array of paths that should be included onto the page in a script tag src with type `module`.
- `styles`: array of paths that should be included onto the page in a `link rel="stylesheet"` tag with the `href` pointing to the paths in the array.
- `children`: A string containing the page's inner content, or whatever type your `ts` page function returns. `md` and `html` page types always return strings.
- `pages`: An array of page data that you can use to generate index pages with, or any other page-introspection based content that you desire.
- `page`: An object with metadata and other facts about the current page being rendered into the template. This will also be found somewhere in the `pages` array.

The default `root.layout.ts` is featured below, and is implemented with [`fragtml`][fragtml], though it could just be done with a template literal or any other template system that runs in Node.js. See the [`fragtml` docs][fragtml-docs] for escaping, raw HTML, rendering, and fragment usage.

`root.layout.ts` can live anywhere in the `src` directory.

```typescript
import { html, raw, render } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'
import type { LayoutFunction } from '@domstack/static/types.js'

type RootLayoutVars = {
  title: string,
  siteName: string,
  defaultStyle: boolean,
  basePath?: string
}

export const vars = {
  defaultStyle: true,
}

const defaultRootLayout: LayoutFunction<RootLayoutVars, string | HtmlResult, string> = ({
  vars: {
    title,
    siteName = 'Domstack',
    basePath,
    /* defaultStyle = true  Set this to false in global or page vars to disable the default style in the default layout */
  },
  scripts,
  styles,
  children,
  pages,
  page,
}) => {
  return render(html`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title ? `${title}` : ''}${title && siteName ? ' | ' : ''}${siteName}</title>
        <meta name="viewport" content="width=device-width, user-scalable=no" />
        <meta name="color-scheme" content="light dark" />
        ${scripts
          ? scripts.map(script => html`<script type="module" src="${script.startsWith('/') ? `${basePath ?? ''}${script}` : script}"></script>`)
          : null}
        ${styles
          ? styles.map(style => html`<link rel="stylesheet" href="${style.startsWith('/') ? `${basePath ?? ''}${style}` : style}" />`)
          : null}
      </head>
      <body class="safe-area-inset">
        <main class="mine-layout app-main">${typeof children === 'string' ? raw(children) : children}</main>
      </body>
    </html>
  `)
}

export default defaultRootLayout
```

If your `src` folder doesn't have a `root.layout.ts` file somewhere in it, `domstack` will use the default [`default.root.layout.js`](./lib/defaults/default.root.layout.js) file it ships. The default `root` layout includes a special boolean variable called `defaultStyle` that lets you disable a default page style (provided by [mine.css](http://github.com/bcomnes/mine.css)) that it ships with.

### Layout styles

You can create a `${layout-name}.layout.css` next to any layout file.
While the layout file can live anywhere in `src`, the layout style must live next to the associated layout file.

```css
/* /layouts/article.layout.css */
.layout-specific-class {
  color: blue;

  & .button {
    color: purple;
  }
}

/* This layout style is included in every page rendered with the 'article' layout */
```
Layout styles are loaded on all pages that use that layout.
Layout styles are bundled with [`esbuild`][esbuild] and can bundle relative and `npm` css using css `@import` statements.
DOMStack loads stylesheets in this order: global, layout, then page. Under the normal [CSS cascade](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascade/Cascade), later styles take precedence when origin, importance, cascade layer, and specificity are otherwise equal. This lets page styles override layout styles, and layout styles override global styles.


### Layout client bundles

You can create a `${layout-name}.layout.client.ts` next to any layout file.
While the layout file can live anywhere in `src`, the layout client bundles must live next to the associated layout file.

> [!NOTE]
> Use `${layout-name}.layout.client.tsx` when a layout client bundle contains JSX. You can also use `.jsx`. See [Supported file types](#supported-file-types) for all available extensions and [`.tsx` client bundles](#tsx) for JSX configuration.

```typescript
/* /layouts/article.layout.client.ts */

console.log('I run on every page rendered with the \'article\' layout')

/* This layout client is included in every page rendered with the 'article' layout */
```

Layout client bundles are loaded on all pages that use that layout.
Layout client bundles are built with [`esbuild`][esbuild] and can bundle relative and `npm` modules using ESM `import` statements.

### Layout types

Layouts can be typed using `LayoutFunction<T, U, V>` where:

- `T` is the variables type
- `U` is the type of content received from pages (defaults to `any`)
- `V` is the layout's return type (defaults to `string` for HTML output)

```typescript
import type { LayoutFunction } from '@domstack/static/types.js'
import type { HtmlResult } from 'fragtml/types.js'
import { html, raw, render } from 'fragtml'

type ArticleLayoutVars = {
  title: string
  showSidebar: boolean
}

const articleLayout: LayoutFunction<ArticleLayoutVars, string | HtmlResult, string> = ({
  vars,
  children,
}) => {
  return render(html`
    <article>
      <h1>${vars.title}</h1>
      ${typeof children === 'string' ? raw(children) : children}
      ${vars.showSidebar ? html`<aside>Related articles</aside>` : null}
    </article>
  `)
}

export default articleLayout
```

## Variables

### Variable providers

DOMStack accepts variable providers anywhere variables can be supplied. A variable provider is an object or a sync/async function that returns an object.

Object provider:

```typescript
// src/global.vars.ts
export default {
  siteName: 'My site'
}
```

Synchronous function provider:

```typescript
// src/global.vars.ts
export default function vars () {
  return {
    siteName: 'My site'
  }
}
```

Asynchronous function provider:

```typescript
// src/global.vars.ts
export default async function vars () {
  return {
    siteName: 'My site'
  }
}
```

Pages and layouts receive an object with the following parameters:

- `vars`: An object with the variables of `global.vars.ts`, [`global.data.ts`](#global-data), `page.vars.ts`, and any frontmatter or `vars` exports from the page merged together.
- `pages`: The available [`PageData` collection](#page-data-and-introspection).
- `page`: The current page's [`PageInfo` metadata](#page-metadata).

Template files receive a similar set of variables:

- `vars`: An object with the variables from `global.vars.ts` and [`global.data.ts`](#global-data).
- `pages`: The available [`PageData` collection](#page-data-and-introspection).
- `template`: Information about the current template file.

## Static assets

All static assets in the `src` directory are copied 1:1 to the destination directory using [cpx2](https://github.com/bcomnes/cpx2). Files ending in `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.html`, or `.md` are reserved for DOMStack processing and are not copied as static assets.

### `--copy` directories

You can specify directories to copy into your `dest` directory using the `--copy` flag. Everything in those directories will be copied as-is into the destination, including js, css, html and markdown, preserving the internal directory structure.

> [!NOTE]
> `--copy` intentionally accepts directories, not individual files. Place a file in a directory whose structure encodes its desired destination path. To copy multiple directories, repeat the flag: `domstack --copy oldsite --copy archived-docs`.

> [!WARNING]
> DOMStack does not detect conflicts between copied directories and other build output. If multiple inputs produce the same destination path, the result is undefined.

Copy folders must live **outside** of the `dest` directory. Copy directories can be in the src directory allowing for nested builds. In this case they are added to the ignore glob and ignored by the rest of `domstack`.

> [!NOTE]
> When using the programmatic `DomStack` constructor, `copy` entries may be relative or absolute paths. Relative paths are resolved from the current working directory, matching the CLI `--copy` behavior, before being stored in `domstack.opts.copy` and passed to the copy build step.
>
> ```typescript
> const site = new DomStack('src', 'public', {
>   copy: ['./legacy-site', '/srv/shared-docs'],
> })
> ```

The intention of this feature is to include legacy or archived site content without asking DOMStack to process or modify it. In general, static content should live in your primary `src` directory, but keeping older content in a separate, unprocessed directory can make it easier to merge into the final build.

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

There are a few important and optional global files that can live anywhere in the `src` directory. Global browser assets preserve their source-relative directory when built into `dest`. For example, `src/assets/global.css` produces an output such as `dest/assets/global-[hash].css`. Build-time files such as `global.vars.ts`, `esbuild.settings.ts`, and `markdown-it.settings.ts` are consumed by DOMStack and are not emitted.

Only one file may match each global filename pattern. When DOMStack discovers a duplicate, it keeps the first file it found, skips the duplicate, and reports a warning. Define each global file once rather than relying on discovery order.

> [!NOTE]
> Wherever this section uses `.ts`, you can also use `.js`. Type checking is supported in both file types. See [Supported file types](#supported-file-types) for all available extensions.

### `global.vars.ts`

The `global.vars.ts` file should default-export a [variable provider](#variable-providers).
The variables in this file are available to all pages, unless the page sets a variable with the same key, taking a higher precedence.

```typescript
export default {
  siteName: 'The name of my website',
  authorName: 'Mr. Wallace'
}
```

#### `browser` variable

`global.vars.ts` can uniquely export a [`browser` variable provider](#variable-providers). These variables are made available in all client bundles.

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
> Setting `define` in [`esbuild.settings.ts`](#esbuild-settingsts) while also using the `browser` export will throw an error. Use one or the other.

### `global.client.ts`

This is a script bundle that is included on every page. It provides an easy way to inject analytics, or other small scripts that every page should have. Try to minimize what you put in here.

> [!NOTE]
> Use `global.client.tsx` when the global client bundle contains JSX. You can also use `global.client.jsx`. See [Supported file types](#supported-file-types) for all available extensions and [`.tsx` client bundles](#tsx) for JSX configuration.

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

### `esbuild.settings.ts`

This is an optional file you can create anywhere.
It should export a default sync or async function that accepts a single argument (the esbuild settings object generated by domstack) and returns a modified build object.
Use this to customize the esbuild settings directly.

Important esbuild settings you may want to set here are:

- [target](https://esbuild.github.io/api/#target) - Set the `target` to make `esbuild` run a few small transforms on your CSS and JS code.
- [jsx](https://esbuild.github.io/api/#jsx) - Configure how esbuild transforms JSX and TSX.
- [jsxImportSource](https://esbuild.github.io/api/#jsx-import-source) - Set this when using an automatic JSX runtime such as React or Preact.
- [define](https://esbuild.github.io/api/#define) - Define compile-time constants for JS bundles. Setting `define` here conflicts with the [`browser` export](#browser-variable) in `global.vars.ts` and throws an error if both are set.

> [!WARNING]
> An invalid esbuild override can break DOMStack's browser build. Preserve DOMStack's required build options unless you intentionally replace their behavior.

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

DOMStack passes its complete default `BuildOptions` into this function. The default browser build:

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
> Images imported by a client bundle are embedded regardless of their size by default. Use the `file` loader when large images should remain separate files.

The function's return value becomes the effective esbuild configuration. Preserve DOMStack's build wiring, including `entryPoints`, `outdir`, and `outbase`, unless you intentionally replace that behavior. Spread nested options such as `loader` when adding entries because replacing the object discards its existing defaults. DOMStack preserves its reserved `define` values after the override runs.

These options also form the basis of the [service-worker](#service-workers) build. DOMStack replaces the service-worker entry point and filename and disables code splitting, while options such as plugins, loaders, `target`, and JSX configuration carry over.

You can return a shallow copy that modifies the defaults when you only need a small change. For example, this keeps DOMStack's default asset loaders and adds a custom loader for `.wasm` files:

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

## Global data

The `global.data.ts` file is an optional file that can live anywhere in your `src` tree. The first one found wins and duplicates warn. It runs **once per build**, after [source-backed pages](#pages) are initialized and before generated-page factories run.

> [!NOTE]
> `global.data.js` works too. See [Supported file types](#supported-file-types) for all available extensions.

For data that aggregates across multiple pages — like blog indexes, sitemaps, or RSS feed content — use `global.data.ts`. It receives the fully resolved source-backed `PageData[]` array and returns an object that is passed to generated-page factories and stamped onto every source-backed and generated page's vars. The derived data is therefore available to every page, layout, and template at final render time.

```typescript
// src/global.data.ts
import type { AsyncGlobalDataFunction } from '@domstack/static/types.js'
import { html, render } from 'fragtml'

type GlobalData = {
  blogPostsHtml: string
}

const buildGlobalData: AsyncGlobalDataFunction<GlobalData> = async ({ pages }) => {
  const blogPosts = pages
    .filter(p => p.vars?.layout === 'blog' && p.vars?.publishDate)
    .sort((a, b) => new Date(b.vars.publishDate) - new Date(a.vars.publishDate))
    .slice(0, 5)

  const blogPostsHtml = render(html`
    <ul class="blog-index-list">
      ${blogPosts.map(p => html`
        <li class="blog-entry h-entry">
          <a class="blog-entry-link u-url u-uid p-name" href="${p.pageInfo.url}">
            ${p.vars?.title}
          </a>
        </li>
      `)}
    </ul>
  `)

  return { blogPostsHtml }
}

export default buildGlobalData
```

The returned object is stamped onto every page's vars before rendering, so any page or layout can read the derived data via `vars`:

```md
<!-- src/page.md -->
## [Blog](./blog/)

{{{ vars.blogPostsHtml }}}
```

**Key properties of `global.data.ts`:**

- **Centralizes page collation and processing.** Collect, filter, group, and sort pages once, then share the result with generated pages, normal pages, layouts, and templates instead of repeating the same work in each downstream consumer.
- Receives fully resolved source-backed `PageData[]` — every page has `.vars` (merged global + page + builder vars), `.pageInfo` (path, type, etc.), `.styles`, `.scripts`, and more. Generated pages do not exist yet.
- Runs inside the worker process (same as all other dynamic imports) to avoid ESM caching issues.
- Skipped entirely if no `global.data.*` file exists — zero overhead.
- Changes to `global.data.*` trigger a full page rebuild (same as `global.vars.*`), since the output is stamped onto every page's vars.

### Global data types

Use `GlobalDataFunction<T>` for a synchronous function or `AsyncGlobalDataFunction<T>` for an async function. In both types, `T` describes the derived variables object returned by `global.data.ts`:

```typescript
// src/global.data.ts
import type { GlobalDataFunction } from '@domstack/static/types.js'

type DerivedData = {
  pageCount: number
  pageUrls: string[]
}

const globalData: GlobalDataFunction<DerivedData> = ({ pages }) => {
  return {
    pageCount: pages.length,
    pageUrls: pages.map(page => page.pageInfo.url),
  }
}

export default globalData
```

Use `AsyncGlobalDataFunction<DerivedData>` instead when the implementation needs to await rendering, network requests, or other asynchronous work.

### Global data caveats

> [!CAUTION]
> `page.vars` is a cached, shallow-frozen object containing the resolved variable cascade. Treat it as read-only. Create a new object when you need to add or replace values.

```typescript
// src/global.data.ts
// Do not mutate the resolved page variables.
page.vars.slug = createSlug(page.vars.title)

// Create a new object instead.
const derivedVars = {
  ...page.vars,
  slug: createSlug(page.vars.title),
}
```

> [!WARNING]
> Accessing `page.vars` throws when that page failed to initialize, such as when a page-variable module contains a syntax error, missing dependency, or runtime error. Fix the underlying page initialization failure rather than treating missing variables as valid data.

> [!NOTE]
> Raw Markdown is not exposed as `page.vars.content`. Markdown variables include frontmatter-derived values such as `title`. Call `readMarkdownContent()` when you need the source body.

```typescript
// src/global.data.ts
const markdownSources = await Promise.all(
  pages
    .filter(page => page.pageInfo.type === 'md')
    .map(async page => ({
      path: page.pageInfo.path,
      markdown: await page.readMarkdownContent(),
    }))
)
```

> [!TIP]
> `global.data.ts` can call `renderInnerPage()` because it runs after source-backed page initialization has been attempted. The same initialization caveat applies, and rendering requires the current `pages` collection.

```typescript
// src/global.data.ts
const renderedPages = await Promise.all(
  pages.map(async page => ({
    path: page.pageInfo.path,
    html: await page.renderInnerPage({ pages }),
  }))
)
```

See [Rendering page content](#rendering-page-content) for rendering semantics and performance guidance.

## Generated Pages

Generated-pages files create one or more DOMStack pages from a central `*.pages.*` module.
Unlike templates, generated pages use the normal page and layout pipeline: each definition supplies page variables and children, which DOMStack renders through the selected layout.
Use generated pages for data-driven output such as blog index pages or HTML redirects derived from frontmatter.

Generated-pages files use the `*.pages.ts` suffix.

> [!NOTE]
> Wherever you see `*.pages.ts` being used, you can also use `*.pages.js`. Type checking is supported in both file types. See [Supported file types](#supported-file-types) for all available extensions.

### Generated-pages exports

Like [variable providers](#variable-providers), generated-page factories may be synchronous or asynchronous. Unlike variable providers, they return page definitions and may produce multiple results.

A generated-pages module can default-export:

| Export | Use when |
|---|---|
| One `GeneratedPageDefinition` object | The module always creates one page |
| An array of definitions | The module always creates a fixed set of pages and needs no build context |
| A normal or `async` function | Definitions depend on source pages, global or derived data, or other discovery data |
| An async iterable, usually returned by `async function*` | Pages are discovered incrementally or the total is not known in advance |

Static objects and arrays do not receive factory parameters.

#### One page definition

Export one object when the module always creates a single page:

```ts
// src/about.pages.ts
export default {
  outputName: 'about/index.html',
  vars: { layout: 'root', title: 'About' },
  children: '<p>About this site</p>',
}
```

#### Page definition array

Export an array when the module always creates a fixed set of pages:

```ts
// src/legal.pages.ts
export default [
  {
    outputName: 'terms/index.html',
    vars: { layout: 'legal', title: 'Terms' },
    children: 'Terms of service',
  },
  {
    outputName: 'privacy/index.html',
    vars: { layout: 'legal', title: 'Privacy' },
    children: 'Privacy policy',
  },
]
```

#### Synchronous factory

Export a function when definitions depend on source pages or shared variables:

```ts
// src/tag-indexes.pages.ts
export default function tagIndexes ({ vars }) {
  return Object.entries(vars.tagIndex).map(([tag, posts]) => ({
    outputName: `tags/${tag}/index.html`,
    vars: { layout: 'tag-index', title: `Posts tagged ${tag}`, posts },
  }))
}
```

For a complete two-stage factory example, see [Generate yearly blog index pages](#generate-yearly-blog-index-pages).

#### Asynchronous factory

Export an async function when creating definitions requires asynchronous work:

```ts
// src/team.pages.ts
import { readFile } from 'node:fs/promises'

export default async function teamPages () {
  const members = JSON.parse(
      await readFile(new URL('./data/team.json', import.meta.url), 'utf8')
    )

  return members.map(member => ({
    outputName: `team/${member.slug}/index.html`,
    vars: { layout: 'profile', title: member.name, member },
  }))
}
```

#### Async iterable

Export an async generator when pages should be yielded incrementally:

```ts
// src/archive.pages.ts
export default async function * archivePages ({ vars }) {
  for (const year of vars.blogYears) {
    yield {
      outputName: `blog/${year}/index.html`,
      vars: { layout: 'archive', year },
    }
  }
}
```

### Generated-pages factory parameters

Functions receive one object with:

> [!IMPORTANT]
> Generated-page factories receive only [source-backed pages](#pages). They do not receive pages generated by the same or other `*.pages.ts` files.

| Parameter | Contents |
|---|---|
| `pages` | Initialized source-backed `PageData[]`. Generated pages from this or other pages files are not included. |
| `vars` | Default and global vars plus the values returned by `global.data.*`. |
| `pagesFile` | Information about the current file. `name` is the filename without its `.pages.*` suffix, `path` is its source-relative directory, and `pagesFile` contains the underlying file information. |
| `siteData` | Discovery data returned by `identifyPages()`. Its `siteData.pages` array is also source-backed only. |

Every `*.pages.ts` factory receives the same snapshot of source-backed pages and global data. A `*.pages.ts` file cannot access pages created by another `*.pages.ts` file, regardless of file processing order. After every factory finishes, DOMStack adds all generated pages to the final `pages` collection used while rendering page functions, layouts, and templates.

### Generated page definitions

| Field | Behavior |
|---|---|
| `outputName` | Output path relative to the pages file's directory. It must name a file, must not be absolute or contain `..` segments, and cannot end in a path separator. Defaults to `<pages-file-name>/index.html`. |
| `vars` | Page-level vars merged with the normal default, global, layout, and builder vars. |
| `children` | Optional static child content or inline `PageFunction` rendered before the layout. |
| `draft` | When `true`, the page is omitted unless the CLI uses `--drafts` or a programmatic build uses `buildDrafts: true`. |

Generated pages use [global assets](#global-assets) and [layout assets](#layout-styles). They do not have page-local `style.css`, `client.js`, or worker entries because they do not have their own source-page directory.

### Generated-pages types

Use `GeneratedPageDefinition<T, U>` to type an individual definition. `T` is the generated page's variables type, and `U` is its children type, which defaults to `string`:

```ts
// src/terms.pages.ts
import type { GeneratedPageDefinition } from '@domstack/static/types.js'

type LegalPageVars = {
  layout: string
  title: string
}

const terms: GeneratedPageDefinition<LegalPageVars> = {
  outputName: 'terms/index.html',
  vars: { layout: 'legal', title: 'Terms' },
  children: 'Terms of service',
}

export default terms
```

Use `PagesFunction<T, U, V>` for normal functions, async functions, and async generators:

- `T` is the variables type added to each generated page.
- `U` is the generated children type (defaults to `string`).
- `V` is the default, global, and derived variables type received by the factory.

```ts
// src/archive.pages.ts
import type { PagesFunction } from '@domstack/static/types.js'

type ArchiveVars = { layout: string, year: number }
type CollectionVars = { blogYears: number[] }

const archivePages: PagesFunction<ArchiveVars, string, CollectionVars> = async function * ({ vars }) {
  for (const year of vars.blogYears) {
    yield {
      outputName: `blog/${year}/index.html`,
      vars: { layout: 'archive', year },
    }
  }
}

export default archivePages
```

For metadata-driven redirects, see the cookbook recipe [Generate redirect pages from page metadata](#generate-redirect-pages-from-page-metadata).

## Templates

Template files let you write any kind of file type to the `dest` folder while customizing the contents of that file with access to the site [Variables](#variables) object, or inject any other kind of data fetched at build time. Template files can be located anywhere in the `src` directory. For a complete feed-generation recipe, see [Generate RSS and JSON feeds](#generate-rss-and-json-feeds).

Template files look like:

```bash
name-of-template.txt.template.ts
${name-portion}.template.ts
```

Template files are `.ts` files that default-export one of the following sync/async functions:

> [!NOTE]
> Wherever you see `.template.ts` being used, you can also use `.template.js`. Type checking is supported in both file types. See [Supported file types](#supported-file-types) for all available extensions.

### Simple string template

A function that returns a string. The `name-of-template.txt` portion of the template file name becomes the file name of the output file.

```typescript
// name-of-template.txt.template.ts
import type { TemplateFunction } from '@domstack/static/types.js'

interface TemplateVars {
  foo: string;
  testVar: string;
}

const simpleTemplate: TemplateFunction<TemplateVars> = async ({
  vars: {
    foo,
    testVar
  }
}) => {
  return `Hello world

This is just a file with access to global vars: ${foo}`
}

export default simpleTemplate
```

### Object template

A function that returns a single object with a `content` and `outputName` entries. The `outputName` overrides the name portion of the template file name.

```typescript
import type { TemplateFunction } from '@domstack/static/types.js'

interface TemplateVars {
  foo: string;
}
export default async ({
  vars: { foo }
}) => ({
  content: `Hello world

This is just a file with access to global vars: ${foo}`,
  outputName: './single-object-override.txt'
})
```

### Object array template

A function that returns an array of objects with a `content` and `outputName` entries. This template file generates more than one file from a single template file.

```typescript
import type { TemplateFunction } from '@domstack/static/types.js'

interface TemplateVars {
  foo: string;
  testVar: string;
}

const objectArrayTemplate: TemplateFunction<TemplateVars> = async ({
  vars: {
    foo,
    testVar
  }
}) => {
  return [
    {
      content: `Hello world

This is just a file with access to global vars: ${foo}`,
      outputName: 'object-array-1.txt'
    },
    {
      content: `Hello world again

This is just a file with access to global vars: ${testVar}`,
      outputName: 'object-array-2.txt'
    }
  ]
}

export default objectArrayTemplate
```

### AsyncIterator template

An [AsyncIterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncIterator) that `yields` objects with `content` and `outputName` entries.

```typescript
import type { TemplateAsyncIterator } from '@domstack/static/types.js'

interface TemplateVars {
  foo: string;
  testVar: string;
}

const templateIterator: TemplateAsyncIterator<TemplateVars> = async function * ({
  vars: {
    foo,
    testVar
  }
}) {
  // First item
  yield {
    content: `Hello world

This is just a file with access to global vars: ${foo}`,
    outputName: 'yielded-1.txt'
  }

  // Second item
  yield {
    content: `Hello world again

This is just a file with access to global vars: ${testVar}`,
    outputName: 'yielded-2.txt'
  }
}

export default templateIterator
```

Templates receive the current page collection through `pages`. See [Page data and introspection](#page-data-and-introspection) for page metadata and rendering methods.

### Choosing a template return type

Use the simplest return type that fits your needs:

| Return type | Multiple outputs | Custom output path | Buffers the output set | Use when |
|---|---|---|---|---|
| String | No | No (derived from template filename) | — | Single file, output path derived from template filename |
| Object | No | Yes | — | Single file with a custom output path |
| Array | Yes | Yes | Yes | Fixed set of output files known at build time |
| AsyncIterator | Yes | Yes | No | Dynamic or unknown number of outputs, or when outputs should be yielded incrementally without buffering the full set |

Start with a string return and only switch to a more complex type when you need what it provides. All template forms can do async work (string, object, and array all support `async` functions). Choose AsyncIterator specifically when the number of output files is not known until the template runs, or when you want to stream outputs one at a time rather than building the full list in memory first.


## Page data and introspection

Page functions and layouts, including those rendering generated pages, receive metadata for the current page through `page`. Page functions, layouts, and templates receive the final collection of source-backed and generated `PageData` instances through `pages`. Entries in `pages` expose their resolved variables, source metadata, and methods for rendering page content.

```typescript
// src/example/page.ts
export default function examplePage ({ page, pages }) {
  console.log(page.url)
  console.log(pages[0]?.pageInfo.url)
  return ''
}
```

Earlier build stages, including `global.data.ts` and generated-page factories, receive only [source-backed pages](#pages). See [Generated-pages factory parameters](#generated-pages-factory-parameters) for the snapshot available to `*.pages.ts` files.

### Page metadata

The current `page` is a `PageInfo` object with the following properties:

- `type`: The page type (`md`, `html`, or `js`).
- `path`: The source-relative directory path for the page.
- `url`: The canonical URL path, such as `/blog/my-post/` for index pages or `/blog/loose-page.html` for loose pages.
- `outputName`: The final output filename.
- `outputRelname`: The destination-relative output path.
- `pageFile`: Source-file path details.
- `pageStyle`: File information when the page has a page style.
- `clientBundle`: File information when the page has a client bundle.
- `pageVars`: File information when the page has an adjacent page-variable file.
- `generated`: Metadata about the `*.pages.ts` file that created a generated page, or `undefined` for a source-backed page.

Each `PageData` entry exposes this object as `page.pageInfo`. Combine `page.pageInfo.url` with a `siteUrl` from `global.vars.ts` to build an absolute URL: `` `${vars.siteUrl}${page.pageInfo.url}` ``. The [RSS and JSON feed recipe](#generate-rss-and-json-feeds) uses this pattern for feed item URLs.

### Rendering page content

Each `PageData` instance exposes two methods for accessing rendered output. This is useful when another generated file needs to embed a page's content, such as the [`feeds.template.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/feeds.template.ts) implementation in the [RSS and JSON feed recipe](#generate-rss-and-json-feeds).

- `await page.renderInnerPage({ pages })` returns the page's inner render output as produced by its builder, without a layout wrapper applied. This is often an HTML string, such as Markdown rendered to HTML, but the type depends on the page builder.
- `await page.renderFullPage({ pages })` returns the complete page output with its layout applied.

Both methods are async and require the `pages` array available at that build stage. Rendering errors propagate and fail the build.

### Rendering many pages

Use [`global.data.ts`](#global-data) to pre-render content shared by multiple downstream pages or templates. This centralizes the work and makes the result available through the resolved variable cascade:

```typescript
// src/global.data.ts
import type { AsyncGlobalDataFunction } from '@domstack/static/types.js'

const globalData: AsyncGlobalDataFunction = async ({ pages }) => {
  const entries = await Promise.all(
    pages.map(async page => [
      page.pageInfo.path,
      await page.renderInnerPage({ pages })
    ] as const)
  )

  return { renderedPagesByPath: Object.fromEntries(entries) }
}

export default globalData
```

Rendering performed inside `global.data.ts` cannot use the derived values that the same file is still computing. After `global.data.ts` returns, DOMStack adds those values to the page variable cascade before the normal rendering pass.


## TypeScript Support

`domstack` supports **TypeScript** via native type-stripping in Node.js.
It helps you write better Javascript and with type stripping, has very little overhead.
It's recommended that you use it!

- **Requires Node.js ≥23** *(built-in)* or **Node.js 22** with the `NODE_OPTIONS="--experimental-strip-types" domstack` env variable.
- Seamlessly mix `.ts`, `.mts`, `.cts` files alongside `.js`, `.mjs`, `.cjs`.
- No explicit compilation step needed—Node.js handles type stripping at runtime.
- Fully compatible with existing `domstack` file naming conventions.
- Anywhere DOMStack loads JS files, it can now load TS files.

### Supported File Types

Anywhere you can use a `.js`, `.mjs`, or `.cjs` file in DOMStack, you can use the corresponding `.ts`, `.mts`, or `.cts` extension.

> [!TIP]
> Prefer the regular `.ts` and `.js` extensions with [`"type": "module"`](https://nodejs.org/api/packages.html#type) in `package.json`. Use the module-format escape-hatch extensions only when an individual file must override the package's module format.

When running in a Node.js context, [type-stripping](https://nodejs.org/api/typescript.html#type-stripping) is used.
When running in a web client context, [esbuild](https://esbuild.github.io/content-types/#typescript) type stripping is used.
Type stripping provides 0 type checking, so be sure to set up `tsc` and `tsconfig.json` so you can catch type errors while editing or in CI.

### Recommended `tsconfig.json`

Install [@voxpelli/tsconfig](https://ghub.io/@voxpelli/tsconfig), which enables type checking in `.js` and `.ts` files and configures TypeScript for `--noEmit`. Extend its Node.js 22 baseline with DOMStack's type-stripping and client-TSX settings:

```jsonc
// tsconfig.json
{
  "extends": "@voxpelli/tsconfig/node22.json",
  "compilerOptions": {
    "skipLibCheck": true,
    "jsx": "preserve",
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*"],
  "exclude": [
    "node_modules",
    "public",
    "coverage"
  ]
}
```

### Using TypeScript with domstack Types

You can use `domstack`'s built-in types to strongly type your layout, page, and template functions. Runtime values are imported from `@domstack/static`; types are imported from the dedicated `@domstack/static/types.js` entry. The following types are available:

```ts
// src/types.ts
import type {
  // Type a synchronous or asynchronous layout default export
  LayoutFunction,
  // Require a layout default export to return a promise
  AsyncLayoutFunction,
  // Type a synchronous or asynchronous global.data.ts default export
  GlobalDataFunction,
  // Require a global.data.ts default export to return a promise
  AsyncGlobalDataFunction,
  // Type a synchronous or asynchronous TypeScript page function
  PageFunction,
  // Require a TypeScript page function to return a promise
  AsyncPageFunction,
  // Type a template that returns one or more buffered outputs
  TemplateFunction,
  // Type an async-generator template that yields outputs incrementally
  TemplateAsyncIterator,
  // Type a generated-pages factory in a *.pages.ts file
  PagesFunction,

  // Describe one initialized entry in the pages collection
  PageData,
  // Describe metadata for the current page
  PageInfo,
  // Describe the current *.template.ts file
  TemplateInfo,
  // Describe the current *.pages.ts file
  PagesFileInfo,
  // Describe one page returned by a generated-pages module
  GeneratedPageDefinition,

  // Type a helper that receives a layout function's arguments
  LayoutFunctionParams,
  // Type a helper that receives global.data.ts arguments
  GlobalDataFunctionParams,
  // Type a helper that receives a page function's arguments
  PageFunctionParams,
  // Type a helper that receives a template function's arguments
  TemplateFunctionParams,
  // Type a helper that receives a generated-pages factory's arguments
  PagesFunctionParams,
} from '@domstack/static/types.js'
```

> [!NOTE]
> Use `PageFunction`, `LayoutFunction`, and `GlobalDataFunction` for ordinary synchronous or asynchronous implementations. Their `Async*` variants are available when a type must specifically require a promise return value. `PagesFunction` supports normal functions, `async` functions, and async generators.

The function types are generic and accept variable shapes that you can develop and share between files.

The data and parameter types (`PageData`, `PageInfo`, `TemplateInfo`, `PagesFileInfo`, `GeneratedPageDefinition`, and `*FunctionParams`) are useful when you want to annotate variables or helper functions that receive these objects without using the function types directly:

```ts
// src/page-utils.ts
import type { GlobalDataFunctionParams, PageData, PageInfo } from '@domstack/static/types.js'

function getPublishedPages({ pages }: GlobalDataFunctionParams): PageData[] {
  return pages.filter((p: PageData) => {
    const info: PageInfo = p.pageInfo
    return !info.draft
  })
}
```

#### Advanced type parameters

`PageFunction`, `LayoutFunction`, and `PagesFunction` support additional type parameters for precise input and return type control:

**PageFunction<T, U>**
- `T` - The type of variables passed to the page (required)
- `U` - The return type of the page function (optional, defaults to `any`)

**LayoutFunction<T, U, V>**
- `T` - The type of variables passed to the layout (required)
- `U` - The type of content received from pages as `children` (optional, defaults to `any`)
- `V` - The return type of the layout function (optional, defaults to `string`)

**PagesFunction<T, U, V>**
- `T` - The vars added to generated pages (optional, defaults to `Record<string, any>`)
- `U` - The static children or inline page-function return type (optional, defaults to `string`)
- `V` - The default and global vars received by the pages factory (optional, defaults to `Record<string, any>`)

This allows pages to return custom types (like VDOM or JSON), ensures layouts produce HTML strings, and keeps generated-page vars separate from the vars used to create them:

```ts
// src/rendering-types.ts
// Define custom types
type VDOMNode = {
  type: string
  props: Record<string, any>
  children: Array<VDOMNode | string>
}

// Page returns VDOM
const page: PageFunction<{title: string}, VDOMNode> = ({ vars }) => ({
  type: 'h1',
  props: {},
  children: [vars.title]
})

// Layout accepts VDOM, returns HTML string
const layout: LayoutFunction<{site: string}, VDOMNode, string> = ({ children }) => {
  const html = renderVDOM(children) // Convert VDOM to HTML
  return `<html><body>${html}</body></html>`
}
```

## Advanced

These features customize DOMStack’s rendering pipeline or coordinate generated assets with browser runtimes.

### Custom layout renderers

DOMStack's bundled default layout uses [`fragtml`][fragtml] because the default template only needs safe string manipulation.
You can eject or replace that layout with any Node-compatible renderer that returns an HTML string.
The previous incumbent for this job was `htm/preact` with [`preact-render-to-string`](https://github.com/preactjs/preact-render-to-string).
That is still a good fit when your Node-side pages or layouts produce Preact VNodes, or when you want the same component model on the server and in browser bundles.
If you also want Preact or React in browser JSX/TSX bundles, configure that separately as described in [`.tsx`](#tsx).

```console
npm install htm preact preact-render-to-string
```

```js
/**
 * @import { LayoutFunction } from '@domstack/static/types.js'
 * @import { VNode } from 'preact'
 */
import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

/** @type {LayoutFunction<Record<string, any>, string | VNode, string>} */
export default function rootLayout ({ children, vars, scripts, styles }) {
  return `<!DOCTYPE html>
${render(html`<html lang=${vars.lang ?? 'en'}>
  <head>
    <title>${vars.title}</title>
    ${styles?.map(style => html`<link rel="stylesheet" href=${style} />`)}
    ${scripts?.map(script => html`<script type="module" src=${script}></script>`)}
  </head>
  <body>
    ${typeof children === 'string'
      ? html`<main dangerouslySetInnerHTML=${{ __html: children }} />`
      : html`<main>${children}</main>`}
  </body>
</html>`)}`
}
```

[`preact-render-to-string`](https://github.com/preactjs/preact-render-to-string) works, but it builds a virtual DOM tree just to serialize layout HTML.
For layouts that mostly combine strings and already-rendered page content, [`async-htm-to-string`](https://github.com/voxpelli/async-htm-to-string) keeps the familiar HTM tagged-template style while rendering directly to strings.
That can be a better-performing and more direct tool for server-only layout templates.
You can still use Preact for browser-side components and use `async-htm-to-string` for Node-side layout rendering.

```console
npm install async-htm-to-string
```

```js
/**
 * @import { LayoutFunction } from '@domstack/static/types.js'
 */
import { html, rawHtml } from 'async-htm-to-string'

/** @type {LayoutFunction<Record<string, any>, string, Promise<string>>} */
export default async function rootLayout ({ children, vars, scripts, styles }) {
  return await html`<!DOCTYPE html>
<html lang="${vars.lang ?? 'en'}">
  <head>
    <title>${vars.title}</title>
    ${styles?.map(style => html`<link rel="stylesheet" href="${style}" />`)}
    ${scripts?.map(script => html`<script type="module" src="${script}"></script>`)}
  </head>
  <body>
    <main>${rawHtml(children)}</main>
  </body>
</html>`
}
```

Key differences from `htm/preact` and DOMStack's `fragtml` default:

- **Attribute names are standard HTML.**
Use `class` and `for` rather than React aliases like `className` and `htmlFor`, which `async-htm-to-string` will output literally with no warning.
For attributes like `tabindex`, `tabIndex` is only a casing preference in HTML, but using standard lowercase keeps templates consistent.
- **Always `await` the `html` tag.**
The tag returns an object that resolves to a string asynchronously.
If you return it without `await` from a non-async function, or assign it where a string is expected, you will get `[object Object]` in the output with no error thrown.
Use `async function` and `await` the result.

> [!CAUTION]
> `rawHtml()` bypasses HTML escaping and is equivalent to setting `innerHTML` directly. Only use it with trusted HTML that you generated or sanitized yourself, such as the output of `await page.renderInnerPage({ pages })` or a trusted Markdown renderer. `children` passed to a layout can be any type returned by a page function and may contain unsanitized content; always verify its source before passing it to `rawHtml()`.

### Web workers

You can easily write [web workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) for a page by adding a file called `${name}.worker.ts` or `${name}.worker.js` where `name` becomes the name of the worker filename in the `workers.json` file.
DOMStack will build these similarly to page `client.ts` bundles, and will even bundle split their contents with the rest of your site.

```
page-directory/
  ├── page.js
  ├── client.js
  ├── counter.worker.js  # Worker with counter functionality
  └── data.worker.js     # Worker for data processing
```

To use a woker, load in a `./workers.json` file that is generated along with the worker bundle to get the final name of the worker entrypoint and then create a worker with that filename.

```typescript
// First, fetch the workers.json to get worker paths in your client.ts
async function initializeWorkers() {
  const response = await fetch('./workers.json');
  const workersData = await response.json();

  // Initialize workers with the correct hashed filenames
  const counterWorker = new Worker(
    new URL(`./${workersData.counter}`, import.meta.url),
    { type: 'module' }
  );

  // Use the worker
  counterWorker.postMessage({ action: 'increment' });

  counterWorker.onmessage = (e) => {
    console.log(e.data);
  };

  return counterWorker;
}

const worker = await initializeWorkers();
```

See the [Web Workers Example](https://github.com/domstack/domstack/tree/master/examples/worker-example) for a complete implementation.

### Service workers

DOMStack has full native support for [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API).
Put one site service worker source file anywhere under `src` and domstack will build it to a stable
root `/service-worker.js` output:

```txt
src/
└── globals/
    └── service-worker.ts
```

DOMStack produces:

```txt
public/
└── service-worker.js
```

> [!NOTE]
> Wherever `service-worker.ts` is used, you can also use `service-worker.js`. Type checking is supported in both file types. See [Supported file types](#supported-file-types) for all available extensions.

Only one site service worker source is allowed. If multiple `service-worker.*` sources are present,
domstack fails with `DOM_STACK_ERROR_DUPLICATE_SERVICE_WORKER`. Service workers are bundled using the project’s [`esbuild.settings.ts`](#esbuild-settingsts) configuration, so imports work the same way they do for client bundles and page-scoped web workers. The
entry filename is intentionally not content-hashed because browser service-worker update checks need
a stable URL.

DOMStack provides the service-worker URL and scope to browser bundles through esbuild `define` values:

| Define | Value |
| --- | --- |
| `process.env.DOMSTACK_SERVICE_WORKER_URL` | Public URL of the site service worker, usually `/service-worker.js`, or `""` when no service worker is present |
| `process.env.DOMSTACK_SERVICE_WORKER_SCOPE` | Registration scope for the site service worker, usually `/`, or `""` when no service worker is present |

Register the built service worker from your site client code, usually `global.client.ts`:

```typescript
// src/globals/global.client.ts
const serviceWorkerUrl = process.env.DOMSTACK_SERVICE_WORKER_URL
const serviceWorkerScope = process.env.DOMSTACK_SERVICE_WORKER_SCOPE

if (serviceWorkerUrl && serviceWorkerScope && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(serviceWorkerUrl, {
    scope: serviceWorkerScope,
    type: 'module',
    updateViaCache: 'none'
  })
}
```

DOMStack does not inject this into the default layout. Registration timing, update prompts, development opt-outs, and recovery behavior are application policy, so keep that logic in your global client or an imported client module.

#### Registration and Web App Manifests

Browsers allow service-worker registration only in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), normally HTTPS in production or localhost during development. The service-worker script must be served from the same origin as the page. DOMStack emits it at the origin root so its default scope can cover the entire site. Register it with `type: 'module'` because DOMStack builds the worker as ESM.

A [Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest) is not required to register or run a service worker. Add one when the site also needs installable-app metadata such as its name, icons, start URL, display mode, and theme colors. DOMStack does not generate this browser manifest. Author it as a [static asset](#static-assets) and reference it from the document head:

```html
<!-- HTML generated by src/layouts/root.layout.ts -->
<link rel="manifest" href="/site.webmanifest">
```

See these complete examples:

- [`static-mpa-offline`](./examples/static-mpa-offline/) uses DOMStack's manifest hooks with a custom service worker and registration lifecycle.
- [`static-mpa-workbox-offline`](./examples/static-mpa-workbox-offline/) implements the same offline MPA pattern with Workbox.

> [!CAUTION]
> DOMStack does not clean `dest` before building. Clean the destination before deployment, especially after removing or renaming a service worker, so an old `/service-worker.js` cannot remain publicly available.

### DOMStack manifest

The DOMStack manifest is build metadata for service workers, deployment tools, and other build-time integrations. It is not a [Web App Manifest](#registration-and-web-app-manifests). (A Web App Manifest such as `site.webmanifest` can be generated independently with a [template](#templates).)

A generated manifest resembles:

```jsonc
// public/domstack-manifest.json
{
  "$schema": "https://unpkg.com/@domstack/static@<version>/lib/domstack-manifest/schema.json",
  "version": "a1b2c3...",
  "generatedAt": "2026-08-31T12:00:00.000Z",
  "entries": [
    {
      "outputRelname": "index.html",
      "kind": "page",
      "url": "/",
      "revision": "d4e5f6...",
      "bytes": 1240,
      "contentType": "text/html; charset=utf-8",
      "static": true,
      "role": "navigation"
    }
  ],
  "policy": {
    "offlineFallbackUrl": "/offline/"
  }
}
```

When enabled, DOMStack collects its emitted pages, templates, bundles, workers, copied files, and static assets into a normalized list of public outputs. You can filter that list, expose selected page variables, attach application policy, and consume the finalized result from a hook or programmatic build. The finalized manifest can be injected statically into your service worker or emitted as a standalone `domstack-manifest.json` file.

> [!WARNING]
> The DOMStack manifest pipeline is an unstable preview feature. This includes its schema, settings, hooks, policy and entry variables, and `process.env.DOMSTACK_MANIFEST_*` defines. Pin `@domstack/static` to an exact version when building against this preview API.

The manifest lifecycle is:

1. DOMStack collects and reconciles emitted outputs.
2. Excludes and entry filters run, then selected page variables are attached.
3. DOMStack finalizes the manifest entries, root policy, and deterministic version.
4. `manifestBuilt` hooks receive the finalized manifest.
5. DOMStack bundles the site service worker with any constants defined by the hooks.
6. DOMStack optionally writes `domstack-manifest.json` and returns the manifest from programmatic builds.

The site service worker is omitted from manifest entries. This allows the finalized manifest version to be embedded in `/service-worker.js` without creating a circular content hash.

#### Enable the manifest

The manifest pipeline is disabled by default. Enable it with one of these configuration surfaces:

| Configuration | Pipeline enabled | Writes `domstack-manifest.json` |
|---|---:|---:|
| One `domstack-manifest.settings.ts` file anywhere in `src` | Yes | No |
| `domstackManifest: true` | Yes | Yes |
| `domstackManifest: { ... }` | Yes | Only with `write: true` |
| CLI `--domstackManifest` | Yes | Yes |

A settings file enables manifest reconciliation, hooks, and `results.domstackManifest` without requiring a public JSON file. This is sufficient when a service worker receives its cache policy through an injected build constant.

> [!NOTE]
> Wherever `domstack-manifest.settings.ts` is used, you can also use `domstack-manifest.settings.js`. Type checking is supported in both file types. See [Supported file types](#supported-file-types) for all available extensions.


#### Configure entries and policy

Create one `domstack-manifest.settings.ts` file anywhere under `src`. It can default-export an options object or a synchronous or asynchronous function that returns one.

```typescript
// src/globals/domstack-manifest.settings.ts
import type { DomstackManifestOptions } from '@domstack/static/types.js'

type PageVars = {
  offline?: boolean
  precache?: boolean
}

type ManifestVars = Pick<PageVars, 'offline' | 'precache'>

type ManifestPolicy = {
  offlineFallbackUrl: string
}

const settings = {
  exclude: ['admin/**', '**/*.map'],
  includeEntry: entry => entry.kind !== 'metadata',
  manifestVars: ['offline', 'precache'],
  policy: {
    offlineFallbackUrl: '/offline/'
  }
} satisfies DomstackManifestOptions<
  ManifestPolicy,
  ManifestVars,
  PageVars
>

export default settings
```

The main settings are:

| Setting | Purpose |
|---|---|
| `exclude` | Ignore-style patterns matched against both `entry.url` and `entry.outputRelname` |
| `includeEntry(entry)` | A final synchronous or asynchronous predicate that returns `true` to retain an entry |
| `manifestVars` | An allowlist or per-entry transform that exposes selected resolved page variables |
| `policy` | A manifest-wide object or transform for application-defined policy |
| `hooks.manifestBuilt` | Hooks that consume the finalized manifest before the service worker is bundled |

Only variables explicitly selected by `manifestVars` are copied into entries. Arbitrary page variables are not exposed automatically. `exclude` runs before `includeEntry(entry)`.

The resulting manifest contains:

- `version`: A deterministic digest that changes when retained cache-relevant entries or root policy change
- `generatedAt`: The build timestamp, which does not affect `version`
- `entries`: Included public outputs sorted by URL
- `policy`: Optional application-defined manifest-wide policy

Useful entry fields include `url`, `revision`, `kind`, `bytes`, `contentType`, `integrity`, `urlRevisioned`, `static`, `role`, and explicitly selected `manifestVars`. Import `DomstackManifest` and `DomstackManifestEntry` from `@domstack/static/types.js` when consuming these objects directly.

#### Manifest built hooks

`hooks.manifestBuilt` runs after entries, policy, and version are finalized but before `/service-worker.js` is bundled. Each hook receives:

- `manifest`: The finalized manifest
- `dest`: The absolute destination directory
- `defineServiceWorkerConstant(name, value)`: Injects a JSON-serializable value into only the final service-worker bundle
- `writeFile(outputRelname, contents)`: Writes an additional file under `dest`

Files written by a hook are not added back to the already-finalized manifest. Prefer an injected constant when only the service worker needs the generated data.

#### Service worker integration

A manifest hook can turn the normalized entries into a small application-specific cache policy:

```typescript
// src/globals/domstack-manifest.settings.ts
import type {
  DomstackManifestBuiltHookContext,
  DomstackManifestOptions
} from '@domstack/static/types.js'

export type CachePolicy = {
  version: string
  precacheEntries: Array<{
    url: string
    revision: string | null
    integrity?: string
  }>
}

function injectCachePolicy (
  context: DomstackManifestBuiltHookContext
): void {
  const policy: CachePolicy = {
    version: context.manifest.version,
    precacheEntries: context.manifest.entries
      .filter(entry => entry.static === true)
      .filter(entry => entry.revision)
      .map(entry => ({
        url: entry.url,
        revision: entry.urlRevisioned ? null : entry.revision,
        ...(entry.integrity ? { integrity: entry.integrity } : {})
      }))
  }

  context.defineServiceWorkerConstant('__APP_CACHE_POLICY__', policy)
}

const settings = {
  hooks: {
    manifestBuilt: [injectCachePolicy]
  }
} satisfies DomstackManifestOptions

export default settings
```

The service worker can then consume the injected value without fetching a public manifest at runtime:

```typescript
// src/globals/service-worker.ts
import type { CachePolicy } from './domstack-manifest.settings.ts'

declare const __APP_CACHE_POLICY__: CachePolicy

const cachePolicy = __APP_CACHE_POLICY__
```

Manifest-enabled builds also define:

| Define | Value |
|---|---|
| `process.env.DOMSTACK_MANIFEST_ENABLED` | `"true"` for a manifest-enabled one-shot build and `"false"` otherwise |
| `process.env.DOMSTACK_MANIFEST_VERSION` | The finalized version inside `/service-worker.js`; `""` in other bundles |
| `process.env.DOMSTACK_MANIFEST_URL` | The conventional `/domstack-manifest.json` URL |

`DOMSTACK_MANIFEST_URL` does not guarantee that the JSON file was written. Fetch it only when `--domstackManifest`, `domstackManifest: true`, or `{ write: true }` enabled public output.

> [!IMPORTANT]
> Watch mode still bundles the service worker, but it does not finalize, return, or write the DOMStack manifest. Manifest hooks do not inject production cache policy in watch mode. Use a one-shot build or `domstack --serve` to test manifest-driven service-worker behavior.

`domstack --serve` runs a normal one-shot build and serves `dest` without watch-mode filenames or live-reload injection:

```console
domstack --serve
domstack --serve --port 3001
```

See the complete examples for production-oriented cache lifecycle behavior:

- [`static-mpa-offline`](./examples/static-mpa-offline/) injects DOMStack manifest entries into a custom service worker.
- [`static-mpa-workbox-offline`](./examples/static-mpa-workbox-offline/) converts the finalized entries into Workbox precaching and routing policy.

#### Programmatic configuration

Configure the manifest through the `DomStack` constructor when coordinating it with another build tool or script:

```typescript
// scripts/build.ts
import { DomStack } from '@domstack/static'

const site = new DomStack('src', 'public', {
  domstackManifest: {
    write: true,
    exclude: ['admin/**', '**/*.map']
  }
})

const results = await site.build()
console.log(results.domstackManifest?.version)
```

### Programmatic test builds

Use the top-level `testBuild` helper to build into a temporary directory from tests without managing setup and cleanup yourself.

```js
import { test } from 'node:test'
import assert from 'node:assert'
import { testBuild } from '@domstack/static'

test('site output', async () => {
  const build = await testBuild('./src')

  try {
    const html = await build.readOutput('index.html')
    assert.match(html, /Hello/)
  } finally {
    await build.cleanup()
  }
})
```

`testBuild(src, opts)` creates a temporary destination directory, runs `new DomStack(src, dest, opts).build()`, and returns `{ dest, results, readOutput, cleanup }`. Options are passed through to `DomStack`, including `copy` paths.

See these repository tests for complete usage:

- [`test-build-helper/index.test.js`](https://github.com/bcomnes/domstack/blob/master/test-cases/test-build-helper/index.test.js) tests temporary output, `readOutput()`, copied directories, and cleanup.
- [`default-layout/index.test.js`](https://github.com/bcomnes/domstack/blob/master/test-cases/default-layout/index.test.js) uses `testBuild()` for a focused output assertion.
- [`generated-pages/index.test.js`](https://github.com/bcomnes/domstack/blob/master/test-cases/generated-pages/index.test.js) uses it with generated pages, global data, and templates.

## Cookbook

Applied examples that combine multiple DOMStack features.

### Compose nested layouts

Pages select their innermost layout with `vars.layout`.
A layout can export a static `parentLayout` name to let DOMStack wrap it in another layout.

```typescript
// article.layout.ts
import { html, raw, render } from 'fragtml'
import type { LayoutFunction } from '@domstack/static/types.js'
import type { RootLayoutVars } from './root.layout.ts'

export const parentLayout = 'root'
export const vars = { showSidebar: true }

const articleLayout: LayoutFunction<RootLayoutVars, string, string> = ({ children }) => {
  return render(html`<article>${raw(children)}</article>`)
}

export default articleLayout
```

```typescript
// posts/example/page.ts
export const vars = { layout: 'article', title: 'A post' }
export default () => '<p>Hello from the post.</p>'
```

DOMStack renders `root(article(page()))`.
A root layout omits `parentLayout`; child layouts can name any discovered layout, including the bundled `root`.
Names are the same filename-derived names used by `vars.layout`, not import paths.
Missing parents, invalid parent exports, and cycles fail the build with the offending layout or chain.

All renderers receive the same resolved vars, page metadata, worker URLs, and asset lists.
Vars merge from outermost to innermost layout, followed by page vars and builder/frontmatter vars.
Layout `vars.layout` does not select a parent; only the named `parentLayout` export establishes nesting.
Async layouts are awaited at every step, and intermediate values pass through unchanged until the final result is serialized.
Each parent must accept the kind of children its immediate child returns.

#### Nested layout client bundles and styles

DOMStack includes each ancestor's own style and client entry automatically.
The order is defaults → globals → outer layouts → inner layouts → page assets.
For example, a post using `article` receives `root.layout.css` before `article.layout.css`.
Do not also import the parent's layout CSS or client from the child: doing both duplicates its contents or execution.

Watch mode uses the resolved chain for source-backed and generated pages.
Changing a parent layout or one of its imported helpers rebuilds descendant pages, and changing the chain updates those relationships after a successful build.
Existing asset edits use esbuild's watcher; adding or removing a layout asset updates the affected pages' asset lists.

#### Manual composition

Manual function composition is supported and tested for source-backed and generated pages.
Prefer `parentLayout` for ordinary nesting: DOMStack can then manage the full chain's defaults, assets, dependencies, and rebuilds for you.
A layout without `parentLayout` still runs once, and it may import and call other render functions itself.
DOMStack does not infer a parent from those imports, merge the imported function's vars, or add its assets.
Manual composition must forward the required arguments and explicitly import parent assets.

```typescript
// manual.layout.ts
import rootLayout from './root.layout.ts'
import type { LayoutFunction } from '@domstack/static/types.js'
import type { RootLayoutVars } from './root.layout.ts'

const manualLayout: LayoutFunction<RootLayoutVars, string, string> = args => {
  return rootLayout({ ...args, children: `<article>${args.children}</article>` })
}

export default manualLayout
```

Static import tracking still rebuilds these pages when an imported parent or helper changes.
If the parent has layout CSS or client code, import those files from the composing layout's corresponding asset entries.
These manual responsibilities are why explicit `parentLayout` nesting is recommended, not a restriction on using ordinary functions.

To migrate, replace the parent function call with a `parentLayout` export and return only the child wrapper.
Move shared defaults into exported layout `vars`, and remove child imports of the parent's layout CSS and client.
Do not keep the manual parent call when adding `parentLayout`, or the parent will render twice.

### Generate RSS and JSON feeds

Templates receive the standard variables available to pages, so they can inspect pages and generate feeds from site content.

The following example generates an [RSS](https://www.rssboard.org) and [JSON Feed](https://www.jsonfeed.org) from the 10 most recent date-sorted pages using the `blog` layout and the AsyncIterator template type. It uses [`renderInnerPage()`](#rendering-page-content) to include each post's rendered HTML. See the [blog example's `feeds.template.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/feeds.template.ts) for a working implementation.

```typescript
import pMap from 'p-map'
import jsonfeedToAtom from 'jsonfeed-to-atom'
import type { TemplateAsyncIterator } from '@domstack/static/types.js'

interface TemplateVars {
  title: string;
  layout: string;
  siteName: string;
  homePageUrl: string;
  authorName: string;
  authorUrl: string;
  authorImgUrl?: string;
  siteDescription: string;
  language: string;
}

const feedsTemplate: TemplateAsyncIterator<TemplateVars> = async function * ({
  vars: {
    siteName,
    siteDescription,
    homePageUrl,
    language = 'en-us',
    authorName,
    authorUrl,
    authorImgUrl,
  },
  pages
}) {
  const blogPosts = pages
    .filter(page => page.pageInfo.path.startsWith('blog/') && page.vars['layout'] === 'blog')
    .sort((a, b) => new Date(b.vars.publishDate) - new Date(a.vars.publishDate))
    .slice(0, 10)

  const jsonFeed = {
    version: 'https://jsonfeed.org/version/1',
    title: siteName,
    home_page_url: homePageUrl,
    feed_url: `${homePageUrl}/feed.json`,
    description: siteDescription,
    author: {
      name: authorName,
      url: authorUrl,
      avatar: authorImgUrl
    },
    items: await pMap(blogPosts, async (page) => {
      return {
        date_published: page.vars['publishDate'],
        title: page.vars['title'],
        url: `${homePageUrl}${page.pageInfo.url}`,
        id: `${homePageUrl}${page.pageInfo.url}#${page.vars['publishDate']}`,
        content_html: await page.renderInnerPage({ pages })
      }
    }, { concurrency: 4 })
  }

  yield {
    content: JSON.stringify(jsonFeed, null, '  '),
    outputName: './feeds/feed.json'
  }

  yield {
    content: jsonfeedToAtom(jsonFeed),
    outputName: './feeds/feed.xml'
  }
}

export default feedsTemplate
```

### Generate yearly blog index pages

Global data centralizes collection and grouping once, then generated pages turn those records into pages. See the working [blog example directory](./examples/blog/), [`global.data.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/global.data.ts), [`blog-indexes.pages.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/blog-indexes.pages.ts), and [`year-index.layout.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/layouts/year-index.layout.ts).

First, collect source-backed pages whose layout is `post`, validate and normalize their publish dates, sort them newest-first, and group them into yearly `blogIndexes`:

```typescript
// src/global.data.ts
import type {
  AsyncGlobalDataFunction,
  GlobalDataFunctionParams,
} from '@domstack/static/types.js'

export interface BlogPost {
  path: string
  title: string
  publishDate: string
}

export interface BlogIndex {
  year: number
  posts: BlogPost[]
}

export interface GlobalData {
  blogIndexes: BlogIndex[]
}

function collectBlogPosts (pages: GlobalDataFunctionParams['pages']): BlogPost[] {
  return pages
    .filter(page => page.vars.layout === 'post')
    .map(page => {
      const value = page.vars.publishDate
      if (typeof value !== 'string' && !(value instanceof Date)) {
        throw new TypeError(`Post "${page.pageInfo.path}" needs a publishDate`)
      }

      const publishDate = new Date(value.valueOf())
      if (Number.isNaN(publishDate.valueOf())) {
        throw new TypeError(`Post "${page.pageInfo.path}" has an invalid publishDate`)
      }

      return {
        path: page.pageInfo.path,
        title: String(page.vars.title ?? 'Untitled'),
        publishDate: publishDate.toISOString(),
      }
    })
    .sort((a, b) => b.publishDate.localeCompare(a.publishDate))
}

const globalData: AsyncGlobalDataFunction<GlobalData> = async ({ pages }) => {
  const postsByYear = new Map<number, BlogPost[]>()

  for (const post of collectBlogPosts(pages)) {
    const year = new Date(post.publishDate).getUTCFullYear()
    postsByYear.set(year, [...(postsByYear.get(year) ?? []), post])
  }

  const blogIndexes = [...postsByYear]
    .map(([year, posts]) => ({ year, posts }))
    .sort((a, b) => b.year - a.year)

  return { blogIndexes }
}

export default globalData
```

Then consume `vars.blogIndexes` and create one `blog/<year>/index.html` page per group using the `year-index` layout:

```typescript
// src/blog-indexes.pages.ts
import type { PagesFunction } from '@domstack/static/types.js'
import type { BlogPost, GlobalData } from './global.data.js'

type YearIndexPageVars = {
  layout: 'year-index'
  title: string
  posts: BlogPost[]
}

const blogIndexes: PagesFunction<YearIndexPageVars, string, GlobalData> = ({ vars }) =>
  vars.blogIndexes.map(({ year, posts }) => ({
    outputName: `blog/${year}/index.html`,
    vars: {
      layout: 'year-index',
      title: String(year),
      posts,
    },
  }))

export default blogIndexes
```

### Generate redirect pages from page metadata

See the working [blog example directory](./examples/blog/), [`redirects.pages.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/redirects.pages.ts), and [`redirect.layout.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/layouts/redirect.layout.ts).

Sites migrating from another platform often need redirect pages for old URLs that no longer exist. Keep that history on the current page with `redirectFrom` metadata instead of maintaining a separate old/new mapping:

```md
---
title: Current Post
redirectFrom:
  - /2020/old-slug/
  - /blog/original-title/
---
<!-- src/blog/current-post.md -->

# Current Post
```

Collect the metadata in `global.data.ts`. The current page's URL becomes the redirect target automatically:

```typescript
// src/global.data.ts
function collectRedirects (pages) {
  const redirects = []
  const redirectOwners = new Map()

  for (const page of pages) {
    const redirectFrom = page.vars.redirectFrom
    if (redirectFrom === undefined) continue

    const source = page.pageInfo.pageFile.relname
    if (!Array.isArray(redirectFrom)) throw new TypeError(`redirectFrom on "${source}" must be an array`)

    for (const from of redirectFrom) {
      if (typeof from !== 'string') throw new TypeError(`redirectFrom entries on "${source}" must be strings`)
      if (from.trim() !== from || !from.startsWith('/') || from.startsWith('//')) throw new Error(`Invalid redirectFrom "${from}" on "${source}": expected a same-origin URL path`)
      if (from.includes('?') || from.includes('#') || from.includes('\\') || from.split('/').some(part => part === '.' || part === '..')) throw new Error(`Invalid redirectFrom "${from}" on "${source}": unsupported URL path`)

      const existingSource = redirectOwners.get(from)
      if (existingSource) throw new Error(`redirectFrom "${from}" is declared by both "${existingSource}" and "${source}"`)

      redirectOwners.set(from, source)
      redirects.push({ from, to: page.pageInfo.url })
    }
  }

  return redirects
}

export default function globalData ({ pages }) {
  return { redirects: collectRedirects(pages) }
}
```

Validation happens while the destination page is still known, so malformed or duplicate metadata reports the page that declared it. The pages factory then consumes the validated collection and renders each old location through a reusable redirect layout:

```typescript
// src/redirects.pages.ts
function redirectOutputName (from) {
  if (!from.startsWith('/') || from.startsWith('//')) throw new Error(`redirectFrom must be a same-origin URL path: ${from}`)
  if (from.includes('?') || from.includes('#')) throw new Error(`redirectFrom must not include a query or fragment: ${from}`)

  const relativePath = from.slice(1)
  if (relativePath.length === 0) return 'index.html'
  return relativePath.endsWith('/') ? `${relativePath}index.html` : relativePath
}

export default function redirectsPages ({ vars }) {
  const pages = []

  for (const { from, to } of vars.redirects) {
    pages.push({
      outputName: redirectOutputName(from),
      vars: {
        layout: 'redirect',
        title: 'Redirecting...',
        redirectTo: to,
      },
    })
  }

  return pages
}
```

```typescript
// src/redirect.layout.ts

import { html, render } from 'fragtml'

export default function redirectLayout ({ vars }) {
  return render(html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${vars.redirectTo}" />
  <link rel="canonical" href="${vars.redirectTo}" />
  <title>${vars.title}</title>
</head>
<body>
  <p>Redirecting to <a href="${vars.redirectTo}">${vars.redirectTo}</a></p>
</body>
</html>`)
}
```

`redirectFrom` contains old same-origin public URL paths. `redirectOutputName()` converts directory URLs such as `/2020/old-slug/` to `2020/old-slug/index.html`. DOMStack's generated-output validation still rejects escaping paths such as `..`. The redirect target comes from the current page's normalized `pageInfo.url`, so moving the page again only requires retaining its previous URLs in that page's metadata. `fragtml` escapes interpolated values by default, including attribute values and link text.

**SEO note:** Meta-refresh is a client-side redirect. Search engines may not treat it as a permanent 301 redirect. For static hosting platforms that support server-side redirects, you can instead generate a `_redirects` file (Netlify, Cloudflare Pages) or `vercel.json` (Vercel) using the object template type:

```typescript
// src/redirects-netlify.txt.template.ts
// Generates a _redirects file for Netlify / Cloudflare Pages.

export default function ({ vars }) {
  return {
    outputName: '_redirects',
    content: vars.redirects.map(({ from, to }) => `${from}  ${to}  301`).join('\n'),
  }
}
```

Both approaches can coexist and consume the same `global.data.ts` redirect collection. Copying a directory that contains a hand-crafted `_redirects` file via `--copy` is also an option when you prefer to manage redirects outside the build.

## Implementation

`domstack` bundles the best tools for every technology in the stack:

- `js` and `css` is bundled with [`esbuild`](https://github.com/evanw/esbuild).
- `md` is processed with [markdown-it](https://github.com/markdown-it/markdown-it).
- static files are processed with [cpx2](https://github.com/bcomnes/cpx2).
- `ts` support via native typestripping in Node.js and esbuild.
- `jsx/tsx` support via esbuild.

These tools are treated as implementation details, but they may be exposed more in the future. The idea is that they can be swapped out for better tools in the future if they don't make it.

### Build Process Flow

The following diagram illustrates the DomStack build process:

```
                    ┌─────────────┐
                    │    START    │
                    └──────┬──────┘
                           │
                           ▼
                 ┌──────────────────┐
                 │ identifyPages()  │
                 │                  │
                 │ • Find pages     │
                 │ • Find layouts   │
                 │ • Find templates │
                 │ • Find globals   │
                 │ • Find settings  │
                 └────────┬─────────┘
                          │
                          │
      ┌───────────────────┼───────────────────┐
      │                   │                   │
      ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ buildEsbuild()  │ │ buildStatic()   │ │  buildCopy()    │
│                 │ │                 │ │                 │
│ • Bundle JS/CSS │ │ • Copy static   │ │ • Copy extra    │
│ • Generate      │ │   files         │ │   directories   │
│   records       │ │ • Record files  │ │ • Record files  │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  buildPages()    │
                    │                  │
                    │ • Process HTML   │
                    │ • Process MD     │
                    │ • Process JS     │
                    │ • Apply layouts  │
                    │ • Record outputs │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Reconcile        │
                    │ Output Manifest  │
                    └────────┬─────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │    Return Results    │
                  │                      │
                  │ • siteData           │
                  │ • esbuildResults     │
                  │ • staticResults      │
                  │ • copyResults        │
                  │ • pageBuildResults   │
                  │ • domstackManifest   │
                  │ • warnings           │
                  └──────────────────────┘
```

The build process follows these key steps:

1. **Page identification** - Scans the source directory to identify all pages, layouts, templates, and global assets
2. **Destination preparation** - Ensures the destination directory is ready for the build output
3. **Parallel asset processing** - Three operations run concurrently and record their outputs:
   - JavaScript and CSS bundling via esbuild
   - Static file copying (when enabled)
   - Additional directory copying (from `--copy` options)
4. **Page building** - Processes pages and normal templates, applying layouts and recording outputs
5. **Manifest reconciliation** - Normalizes recorded outputs, hashes file contents, filters entries, and computes a stable manifest version
6. **Return results** - Writes the manifest when enabled and returns all build results

This architecture allows for efficient parallel processing of independent tasks while maintaining the correct build order dependencies.

#### buildPages() Detail

The `buildPages()` step processes pages in parallel with a concurrency limit:

```
                    ┌──────────────────┐
                    │  buildPages()    │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Resolve Once:    │
                    │ • Global vars    │
                    │ • All layouts    │
                    └────────┬─────────┘
                             │
                ┌────────────▼───────────────┐
                │  Parallel Page Init        │
                │(Concurrency: min(CPUs, 24))│
                └────────────┬───────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  MD Page Task   │    │ HTML Page Task  │    │  JS Page Task   │
├─────────────────┤    ├─────────────────┤    ├─────────────────┤
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │1. Parse MD  │ │    │ │1. Read .html│ │    │ │1. Import .js│ │
│ │ frontmatter │ │    │ │   file      │ │    │ │   module    │ │
│ └──────┬──────┘ │    │ └──────┬──────┘ │    │ └──────┬──────┘ │
│        ▼        │    │        ▼        │    │        ▼        │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │2. Variable  │ │    │ │2. Variable  │ │    │ │2. Variable  │ │
│ │  Resolution │ │    │ │  Resolution │ │    │ │  Resolution │ │
│ └──────┬──────┘ │    │ └──────┬──────┘ │    │ └──────┬──────┘ │
│        ▼        │    │        ▼        │    │        ▼        │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ builder +   │ │    │ │page.vars.js │ │    │ │  Exported   │ │
│ │ page.vars.js│ │    │ │             │ │    │ │  + page.vars│ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                │
                                ▼
                  ┌─────────────────────────────┐
                  │     global.data.ts runs     │
                  │ (receives source PageData[])│
                  └──────────────┬──────────────┘
                                 │
                                 ▼
                  ┌─────────────────────────────┐
                  │ *.pages.* generates pages   │
                  │   using the derived data    │
                  └──────────────┬──────────────┘
                                 │
                                 ▼
                ┌───────────────────────────────┐
                │  Stamp data, render + write   │
                │ (Concurrency: min(CPUs, 24))  │
                └───────────────────────────────┘
```

Variable Resolution Layers, from lowest to highest precedence:
- **Domstack defaults** - Internal defaults such as the default `layout: 'root'`.
- **Global vars** - Site-wide variables from `global.vars.js` (resolved once).
- **Global data** - Derived variables from `global.data.ts`, resolved from [source-backed pages](#pages) before generated-page factories run and available to every page at final render time.
- **Layout vars** - Optional `export const vars` from the selected layout module.
- **Page-specific vars** vary by type:
  - **MD pages**: `page.vars.js` plus builder vars from frontmatter.
  - **HTML pages**: `page.vars.js`.
  - **JS pages**: exported `vars` plus `page.vars.js`.

### Watch mode

Running `domstack --watch` or `domstack -w` performs an initial build, watches the source inputs, and serves `dest` with live reload. Use `domstack --watch-only` when another process serves the output.

Watch mode coordinates three independent watchers:

- **esbuild** uses `context.watch()` for global, layout, and page client bundles, styles, page-scoped Web Workers, and the site service worker.
- **chokidar** watches page, layout, template, generated-pages, variable, and settings modules. DOMStack uses the changed file and its dependency maps to choose a rebuild scope.
- **cpx2** watches static assets under `src` and directories supplied with `--copy`, copying or removing their destination files directly.

> [!NOTE]
> The filenames below use `.ts` by default. You can also use `.js`, and TypeScript client bundles can use `.tsx`. See [Supported file types](#supported-file-types) for all available extensions.

DOMStack uses these rebuild scopes:

- **esbuild only**: esbuild updates an existing browser entry without rendering HTML.
- **Targeted page/template rebuild**: DOMStack renders only the affected source-backed pages or templates.
- **Targeted generated-pages rebuild**: DOMStack renders and reconciles only the outputs owned by affected `*.pages.ts` files.
- **Full page/template rebuild**: DOMStack renders every source-backed and generated page and every template without restarting esbuild.
- **Full rebuild**: DOMStack rediscovers the source tree, restarts esbuild, renders all pages and templates, and refreshes its dependency maps.

Like templates, generated-pages modules rebuild when their own source or imported dependencies change. Receiving the `pages` collection does not create an implicit watch dependency on every source-backed page.

#### What triggers what

| Change | Rebuild scope |
|---|---|
| Existing `page.ts`, `page.html`, `page.md`, or adjacent `page.vars.ts` | That page |
| A module imported by a TypeScript page or `page.vars.ts` | Pages that depend on it |
| Existing `*.layout.ts` or a module it imports | Source-backed pages and generated-page owners using the affected layout |
| Existing `*.template.ts` or a module it imports | Affected templates |
| Existing `*.pages.ts` | Generated outputs owned by that file, then refresh dependency maps |
| A module imported by `*.pages.ts` | Generated outputs owned by the importing files, then refresh dependency maps |
| `markdown-it.settings.ts` | All source-backed Markdown pages, generated pages, and templates |
| `global.data.ts` | All pages and templates |
| `global.vars.ts` or `esbuild.settings.ts` | Full rebuild |
| `domstack-manifest.settings.ts` | No rebuild. The manifest pipeline is disabled in watch mode |
| Existing client, style, Web Worker, or service-worker entry | esbuild only |
| Static asset under `src` or a file under a `--copy` directory | cpx2 copies or removes the output directly |

Adding or removing a file changes the set of discovered build inputs:

| Added or removed file | Rebuild scope |
|---|---|
| Site `service-worker.ts` | Restart esbuild. No page rebuild |
| `global.client.ts` or `global.css` | Restart esbuild and rebuild all pages |
| Layout client or style | Restart esbuild and rebuild source-backed pages and generated-page owners using that layout |
| Page client, style, or Web Worker | Restart esbuild and rebuild that page |
| Any other page, layout, template, generated-pages, variable, or settings file | Full rebuild |

When a full page/template rebuild or targeted generated-pages rebuild no longer claims an output from the previous successful build, DOMStack removes that obsolete page or template output from `dest` without touching outputs owned by unaffected files.

#### Dependency tracking

DOMStack uses [`@11ty/dependency-tree-typescript`](https://github.com/11ty/dependency-tree-typescript) to statically analyze ESM imports. It maintains maps for:

- Layout dependencies, source-backed pages using each layout, and generated-page owner layout membership
- TypeScript pages and adjacent page-variable dependencies
- Template dependencies
- Generated-pages module dependencies
- Current esbuild entry points

The maps are created after the initial build and refreshed after structural or generated-pages rebuilds. Dependency analysis is best-effort. When DOMStack cannot safely determine a targeted scope, it falls back to a broader rebuild or skips an unrelated changed module.

esbuild tracks browser-entry dependencies independently. Changing a module imported by `client.ts` rebundles that entry without rendering page HTML.

#### Stable entry filenames

Watch mode uses stable filenames for esbuild entry outputs:

```text
[dir]/[name]
```

Production builds use content-hashed entry filenames:

```text
[dir]/[name]-[hash]
```

Shared chunks remain content-hashed in both modes:

```text
chunks/[ext]/[name]-[hash]
```

Page HTML points to stable entry files during watch mode. esbuild can update an entry and its chunk imports without requiring DOMStack to render the page again.

#### Manifest behavior

Watch mode builds and rebundles the site service worker, but it does not finalize, return, or write the [DOMStack manifest](#domstack-manifest). Changes to `domstack-manifest.settings.ts` therefore do not trigger a watch rebuild.

Use `domstack --serve` when testing manifest-driven cache behavior. It runs a one-shot build and serves the result without watch-mode filenames or live-reload HTML injection. Add `--domstackManifest` only when the service worker or test needs the public `domstack-manifest.json` file.

#### Build serialization

Chokidar events are serialized through a promise chain. Each page rebuild or esbuild restart completes before the next queued filesystem event is processed, preventing overlapping DOMStack rebuilds during rapid saves.

## Design goals

DOMStack aims to make building a website feel like working directly with the web platform, with a small set of dependable conventions layered on top.

### Be simple and dependable

- Be boring, work well, and make the developer's job easier.
- Prefer convention over configuration. Configuration should be optional and minimal.
- Combine proven tools into one coherent system instead of reimplementing them.
- Avoid clever hacks, speculative abstractions, and complexity that becomes permanent maintenance work.
- Do not over-correct bad input. Clear inputs should produce predictable outputs.

### Build on the web platform

- HTML is the source of truth, and strings are the interchange format between rendering tools.
- Let browsers handle links, navigation, documents, and URLs. Do not add magic behavior to `<a>` or `<link>` elements or require client-side routing.
- Treat pages as shallow applications: each page starts as a new document and a blank canvas. Shared client state is possible, but not assumed.
- Remain library-agnostic. A page or layout is a program, so it can use tagged templates, a rendering library, or any other approach that returns the expected output.

### Make structure visible

- The source directory structure should mirror the site's URL structure.
- Every page should have an obvious entrypoint and build to an `index.html` in its corresponding directory, enabling clean URLs and reliable relative links.
- Keep pages and their assets colocated. Do not require parallel directory trees with matching structures.
- Support both `page.md` and `README.md` entrypoints. `README.md` keeps a source tree navigable on Git hosts, while `page.md` is available when repository navigation is not a concern.

### Keep build steps orthogonal

- Page rendering, static copying, and CSS and JavaScript bundling should remain independent build steps.
- Treat bundling as an optimization over a source tree that stays close to directly runnable web content.
- Keep entry filenames stable and conventional so each build input has an obvious purpose.
- Design independent steps so they can run concurrently when possible and rebuild only the outputs they affect.

### Use standard language tooling

- Use standard file types and syntax rather than framework-specific extensions or editor plugins.
- Use real TC39 ESM and prefer standard `.ts` and `.js` modules with `"type": "module"` over compatibility escape hatches.
- Support TypeScript through Node.js type stripping and JavaScript through JSDoc. Leave static type checking to `tsc`.
- Encourage directly runnable source modules. Language servers, formatters, linters, and debuggers should work without understanding a DOMStack-specific language.

### Prefer durable choices

- Build for the platform that exists now instead of simulating predicted future standards.
- Benefit from passive improvements to browsers, JavaScript, TypeScript, and Node.js by staying close to their conventions.
- Adopt ecosystem trends only when they solve a concrete problem better than the existing platform.

## FAQ

Why DOMStack?

:   DOMStack is named after the [DOM (Document Object Model)](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model) and the concept of stacking technologies together to build websites. It represents the layering of HTML, CSS, and JavaScript in a cohesive build system and its emphasis of using what we have rather than inventing brand new ideas or concepts. Also since I had to replace a Wallace and Gromit reference, it could  maybe also double as a [cheeky](https://youtu.be/tiJ4ffGZ7cM?t=77) homage to Node's former legend `substack`.

How does `domstack` relate to [`top-bun`](https://www.npmjs.com/package/top-bun)?

:   `top-bun` is the former name of `domstack` and was named after the bakery in Wallace & Gromit's [A Matter of Loaf and Death 🍞](https://www.youtube.com/watch?v=zXBmZLmfQZ4) which my kids were watching at the time. The project and package were renamed to DOMStack and `@domstack/static` in v11. See the [`top-bun` to DOMStack migration guide](./docs/v11-migration.md) when updating an older project. The `bun` project took off
and hosed the projects chances at SEO!

How does `domstack` relate to [`sitedown`](https://ghub.io/sitedown)

:   `top-bun` used to be called `siteup` which is sort of like "markup", which is related to "markdown", which inspired the project `sitedown` to which `domstack` is a spiritual off-shoot of. Put a folder of web documents in your `domstack` build system, and generate a website. `domstack` is definitely it's own thing now though!


Is this for real?

:   Yes! The frontend space is crowded and brutal, and full of repeat ideas. DOMStack started and will remain as an opensource-for-one project and my goal is to explore ideas that I haven't seen manifest in ways I would like to see elsewhere.
Usage and contribution is encouraged and welcome and appreciated of course. I already consider the project a success for the goals I set out to achieve with it and don't plan to growth hack it at all.

## Project status

DOMStack is actively developed and currently available as a v12 prerelease. Its core feature set includes:

- Markdown, HTML, and TypeScript pages
- Layouts with colocated styles and client bundles
- Global, layout, and page-scoped variables
- Centralized global data processing
- Generated pages and templates
- Static assets and additional copy directories
- Progressive watch rebuilds with dependency tracking
- TypeScript, JavaScript, and client-bundle TSX support
- Page-scoped Web Workers and a site service worker
- The DOMStack build manifest
- A built-in development server powered by [`@domstack/sync`][domstack-sync]

See the [GitHub roadmap](https://github.com/users/bcomnes/projects/3/) for planned work, or the [changelog](CHANGELOG.md) for completed changes. Issues, ideas, and examples of sites built with DOMStack are welcome.

## Links

- [CHANGELOG](CHANGELOG.md)
- [CONTRIBUTING](CONTRIBUTING.md)
- [Dependencies](dependencygraph.svg)
- [fragtml docs][fragtml-docs]

## License

[MIT](LICENSE)

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
[neocities-img]: https://img.shields.io/website/https/domstack.neocities.org?label=neocities&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAGhlWElmTU0AKgAAAAgABAEGAAMAAAABAAIAAAESAAMAAAABAAEAAAEoAAMAAAABAAIAAIdpAAQAAAABAAAAPgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAAAueefIAAACC2lUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNS40LjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyI+CiAgICAgICAgIDx0aWZmOk9yaWVudGF0aW9uPjE8L3RpZmY6T3JpZW50YXRpb24+CiAgICAgICAgIDx0aWZmOlBob3RvbWV0cmljSW50ZXJwcmV0YXRpb24+MjwvdGlmZjpQaG90b21ldHJpY0ludGVycHJldGF0aW9uPgogICAgICAgICA8dGlmZjpSZXNvbHV0aW9uVW5pdD4yPC90aWZmOlJlc29sdXRpb25Vbml0PgogICAgICAgICA8dGlmZjpDb21wcmVzc2lvbj4xPC90aWZmOkNvbXByZXNzaW9uPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4Kpl32MAAABzBJREFUWAnFVwtwnFUV/v5//31ks5tsE9I8moS0iWETSNKUVpBKDKFQxtrCUIpacHQEGYk16FQHaZ3ajjqjOGWqOKUyMCl2xFoKhQJDBQftpOnAmDZoOyRNjCS1SdO8H5vXPv7rd/7NZvIipQjjmfn23Me555x77rnnv6sppTT8H0n/tG1rmlZIVBG+eW1JBD4t0GA8cYZQcS7ncXL7bFuYPfBJ9mlwtxg3bJoSTvx0tn7LAU48IJNE3GyBj9unrlJC2XRt4vGvLFGGrkXYDxEl03WyDyfRRoiHrxOfiBPU85bovPezi5pHnlmhHq5IsaLAXHhltgPXi+A0VE8X+Dht6lov+uw2rf/8nmIlDjQ+fp1yO/SYnaKYXoOC5QSu8trgddnND7rHv0EvOymwTcbnI867OZ5PLCOKiUIijQgS54nPE3hsfXog2WNY2Z+V5MDXVifjd3/ths/jquL0QyIj9EdC3V6UoLr25KurU73D0ieOEIniKbkc063EduLPRDcR2828/DOpzrbBp0ut3UsEBMe3X2PJuhw2sWHplgjkEViyyBGM93gcf3kkxVP2hNZ1sWfoLg7/jbttJC8jMgiLHHYj4EuIb81I9gQLM92O0iyH+9pUlZSdGDHCJjA0biI/zZ3NxIstsfjKpfFYmROHutYxDwduIo6JAxI6LIq3cSmtpCSg9jF3UsXuix2tHb3L7YZevHRx/FBZvrNzTaEnLTfFQHaSna6CSrghjbVMJzRbtC1KFqC1xT5xAFdnZdxPMcsBS1wpDLHhEoWpiXbj3R8mZ1zoT0Caz677PE4fdDunJYIzd2UtvoKfWwq9+PnRiwgMDd5RX/PGVRIBixLjbNNKpQaP1wO/NzYb47ON0yEzAhUJQjOYJhKFy9DybDcyk+y40DeSdOz5J+5h7CBAxDQdl1k7d5rGHWW74Cz/GdM0gQGSWrMwxTl0VBRSlnSmoblMjIel0zkgN+gKSDFl7G7YMm+C4d8Ix4pvQ4XGPpKC8snQ/vPfvYXiwPuy6tylK3RAFokTpuU/NF8u08dAzbkA/nCylyVeBOanJawJQpcGxjMkB04QdzS0j5ujQVNntZK5BSkwYaIvEEZmQgjm4AeweTOguRah4ZKJdbubeZwKaYl23HptNNQxZeMhE0fqBrDthXZraHTCtKydlF73cFhv67l8FGRnm55sQcGjZ/GTI50IN75kKdMTsywnzMmtj4XmhuDRP13Ag8+2YnA0GrVgWDFmwFld10dN03TXNg2jIMNlKfywn//0BXGyKWBNv904isj5GqjhdmjeJSjMzUDttmUYChpYnS+1ZiY9+IUUrCvxIS/Nic/tbAiOBBkBltoeGn9PRA+c6Jm5Yp5edrIDlWsWw09Ht23IgBrvQ+i9Zy1JcaKE1+zmZTp0c240i7LiwJIPXdPACMnmw9ZriOV2Czu/ES3v7izAdZlx0rw8SQLy/jtu/AEmstfhTP3fcUPRUkS6ziB0eh/M/hZovCkx6ugP4ccvtuO1+gGMMI9IfbGM289j6JSRY/8YEIbmSxM4enoA+2t60MuEm0NyA2xOuL5UDaPgXjQ0NODmW27DgVeOw5a3Dq6Nh2DLWcMnyOjU0v6RME63jloJOjnYZ0VAOozCb8kq4506fG4bOgZCU1fphe/m4osliZNrokwFA3Cs/A7sq6qsgU0bN+LwS9GE9Pv9cLvd8Ofn4Zl7wlC9zXRWSnmUnqvpDVY+1yZ38WgsAjKzX34kNF1DYeQtduLOFT4ceSRvjnFEQrClFMK2/FsIBALYu3evZfw2mxe/Yj1obGzExY4OfPmr98Hu38QCOSGqp+j3tT3RLAZek0SwiMlYxyjIFu6WgX3fzMGNufKonYd49kNGOspLrkdTUxMikQhS4r34tZGDZObEHkccdu3chQ0bNiDc/OoMBQdqe/HOv0aSONhBHJ5yYFLqR+QVoYjyPcT7+mJVLsZ5n988O4gTvHrfX5uKMimjzOJEewhbt25FZ2cnWlpaUF1djdcTR1A6NoH24BiC/E4IKSaiyMuX9OVT/Xh4f5tkn0R+Czc9MOdZzokHLGmuiLPr8qqViqKchqYObcmNvnCeLlajz9+uzGCAOpTiNVabN2+25ETWMAxVV1enzPEBS254X5GqWpsmHwqRkfP4OpdF8y/WmM4psJ3HIVuYMr7n/qwZz6uRp/xq4uQvuSxK4sTBgwfVjh07VH19veInWnW9+j11uDJdlebEj0zqaiC/gSum/gxN3QJOzCA6sIIDv2D0KlhdrWS9Jt2F9aU+FKQ7eeYKi3kaSaur4C29j98lE4P9XWg59z5OnXgDb7/1pvlOY7c5EbYKjug+RFTSeJ90pmi6N/O1KbiKeIqOtJFPhXl6m87OGae8hPoU8SSxaj7dMvahEeCiGUQjcm/LiHLCT8hbUsaGCKk2wqWWNxHykD1LA13kC9JHdmBBLf/D5H8By9d+IkwR5NMAAAAASUVORK5CYII=
