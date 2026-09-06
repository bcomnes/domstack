---
layout: docs
handlebars: false
---

# Page authoring reference

## Table of Contents

[[toc]]

## Pages

Pages are named directories inside `src` with **one of** the following page files:

- `md` pages are [CommonMark](https://commonmark.org) markdown pages, with an optional [YAML](https://yaml.org) front-matter block.
- `html` pages are an inner [HTML](https://developer.mozilla.org/en-US/docs/Web/HTML) fragment that get inserted into the page layout.
- `ts` pages are [TypeScript](https://developer.mozilla.org/en-US/docs/Glossary/TypeScript) files that export a default function that resolves into an inner HTML fragment inserted into the page layout.

> [!NOTE]
> A **source-backed page** is discovered directly from a page file in `src`, rather than created by a `*.pages.ts` module.
Source-backed pages exist before `global.data.ts` and [Generated Pages](../../docs/content/#generated-pages) run.

Variables are available in all pages.
`md` and `html` pages support variable access via [handlebars][hb] template blocks.
`ts` pages receive variables as part of the argument passed to them.
See the [Variables](../../docs/pages/#variables) section for more info.

Pages can define a special variable called [`layout`](../../docs/pages/#layouts) that determines which layout the page is rendered into.

Because pages are just directories, they nest and structure naturally as a filesystem router.
Directories in the `src` folder that lack one of these special page files can exist alongside page directories and can be used to store co-located code or static assets without conflict.

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
- `page.md` and `README.md` files transform to an `index.html` at the same path.
  When both exist in the same directory, `page.md` takes precedence over `README.md`.
  `whatever-name-you-want.md` loose markdown files transform into `whatever-name-you-want.html` files at the same path in the `dest` directory.
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
- `html` pages are the simplest page type in `domstack`.
  They let you build with raw html for when you don't want that page to have access to markdown features.
  Some pages are better off with just raw `html`, and the rules with building `html` in a real `html` file are much more flexible than inside of a `md` file.
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
> Wherever you see `.ts` being used, you can also use `.js`.
Type checking is supported in both file types.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions.

- `ts` pages consist of a named directory with a `page.ts` file that exports a default function returning the contents of the inner page.
- A `ts` page needs to `export default` a function (async or sync) that accepts a variables argument and returns a string of the inner HTML of the page, or any other type that your layout can accept.
- You can specify the return type using `PageFunction<T, U, D>` where `T` is the variables type, `U` is the return type (defaults to `any`), and `D` is the declared global-data shape.
- A `ts` page can export a [`vars` variable provider](../../docs/pages/#variable-providers) that takes highest variable precedence when rendering the page.
  `export vars` is similar to a `md` page's front matter.
- A `ts` page receives the standard `domstack` [Variables](../../docs/pages/#variables) set.
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

It is recommended to use some level of template processing over raw string templates so that HTML is well-formed and variable values are properly escaped.
DOMStack's default layout uses [`fragtml`][fragtml], a safe-by-default HTML tagged template library.
Here is a more realistic TypeScript example that uses `fragtml` and an explicit global-data subscription.


```typescript
import { html } from 'fragtml'
import type { HtmlResult } from 'fragtml/types.js'
import type { PageFunction } from '@domstack/static/types.js'

type BlogVars = {
  favoriteCake: string
}

type BlogData = {
  blogYears: number[]
}

export const vars = {
  favoriteCake: 'Chocolate Cloud Cake',
  dataDeps: ['blogYears'],
}

const blogIndex: PageFunction<BlogVars, HtmlResult, BlogData> = async ({
  vars: { favoriteCake },
  data,
}) => {
  return html`<div>
    <p>I love ${favoriteCake}!!</p>
    <ul>
      ${data.blogYears.map(year => html`
        <li>
          <a href="/blog/${year}/">
            ${year}
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

<a id="tsx"></a>

#### `.tsx`

Client bundles support [`.tsx`](https://www.typescriptlang.org/docs/handbook/jsx.html) through [esbuild's JSX transform](https://esbuild.github.io/content-types/#jsx).

> [!NOTE]
> Wherever you see `.tsx` being used for a client bundle, you can also use [`.jsx`](https://facebook.github.io/jsx/).
Type checking is supported in both file types.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions.

> [!IMPORTANT]
> `.tsx` and `.jsx` are supported only in client bundles.
JSX syntax is unavailable in page files, layouts, templates, settings, and anything else that runs in the Node.js context.

DOMStack does not include a JSX runtime by default.
Install the runtime you want and configure it with `esbuild.settings`.
[Preact][preact] is the recommended JSX runtime for DomStack because it is small, browser-focused, and works well with page-scoped client bundles.
See the [preact-isomorphic](https://github.com/bcomnes/domstack/tree/master/examples/preact-isomorphic/) and [react](https://github.com/bcomnes/domstack/tree/master/examples/react/) examples for complete projects.

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

Each page can also have an adjacent `page.vars.ts` file that default-exports a [variable provider](../../docs/pages/#variable-providers) containing page-specific variables.

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

Page variable files have higher precedence than `global.vars.ts` variables, but lower precedence than frontmatter or `vars` exports from `ts` pages.
See [Variables](../../docs/pages/#variables) for the full variable cascade.

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
> Wherever you see `.layout.ts` being used, you can also use `.layout.js`.
Type checking is supported in both file types.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions.

Example layout file names:

```bash
src/layouts/root.layout.ts # this layout is referenced as 'root'
src/other-layouts/article.layout.ts # this layout is referenced as 'article'
```

At a minimum, your site requires a `root` layout (a file named `root.layout.ts`), though `domstack` ships a default `root` layout so defining one in your `src` directory is optional, though recommended.
Owning your own root layout will make DOMStack updates easier, and give you more control over your site.

All pages have a `layout` variable that defaults to `root`.
If you set the `layout` variable to a different name, pages will build with a layout matching the name you set to that variable.

The following markdown page would be rendered using the `article` layout.

```md
---
layout: 'article'
title: 'My Article Title'
---

Thanks for reading my article
```

A page referencing a layout name that doesn't have a matching layout file will result in a build error.
Filenames determine layout names, but nesting is an explicit module declaration, not a directory or import convention.

### Layout module exports

DOMStack recognizes these exports from a layout module:

| Export | Required | Contract |
| --- | --- | --- |
| `default` | Yes | A synchronous or asynchronous [layout render function](../../docs/pages/#layout-render-function). |
| `vars` | No | An object, or a sync/async function returning an object, providing [layout defaults](../../docs/pages/#layout-variables). |
| `parentLayout` | No | A non-empty string naming the immediate outer layout; see [Declaring nested layouts](../../docs/pages/#declaring-nested-layouts). |

### Declaring nested layouts

Declare a parent with a named `parentLayout` export in the child layout module:

```ts
// src/layouts/article.layout.ts
import type { LayoutFunction } from '@domstack/static/types.js'

export const parentLayout = 'root'

const articleLayout: LayoutFunction<Record<string, never>, string, string> = ({ children }) => {
  return `<article>${children}</article>`
}

export default articleLayout
```

`parentLayout` is a layout name, not a file path or imported function.
For example, `'root'` resolves the discovered `root.layout.ts` or `root.layout.js`, wherever it lives under `src`, or DOMStack's bundled root when no custom root exists.
Names are matched exactly, using the same filename-derived names as the page's `layout` variable.

Omit `parentLayout` (or export `undefined`) when the layout has no parent; DOMStack does not automatically wrap a selected non-root layout in `root`.

DOMStack renders the page, passes its result to `article`, then passes that result to `root`: `root(article(page()))`.
Each parent can declare another parent, forming a chain that ends at a layout without `parentLayout`.
Missing parents and cycles, including a layout naming itself, fail the build.

Every render step is awaited, and each parent receives its immediate child's return value as `children` without intermediate string conversion.
The outermost result is converted to a string for HTML output.
All layouts receive the same final resolved page vars, metadata, and asset lists.
Layout defaults merge outermost-to-innermost before page overrides, and ancestor CSS/client entries are included automatically between global and page assets.
Watch mode tracks the resolved chain and each layout's static imports for source-backed and generated pages, updating those relationships after successful rebuilds.

Each layout can also declare its own global-data subscriptions through `vars.dataDeps`.
DOMStack passes only those declared keys to that layout's `data` argument; a child does not receive its parent's data or need to repeat its declarations.
For rebuilds, the page depends on the union of its own subscriptions and every layout's subscriptions in the declared chain.
See [Data subscriptions in nested layouts](../../docs/cookbook/#data-subscriptions-in-nested-layouts) for typed declarations and examples.

Manual function composition remains supported, but `parentLayout` is recommended so DOMStack manages the ancestor chain and its rebuild dependencies.
Do not both declare a parent and call its render function manually, or the parent will render twice.
See [Compose nested layouts](../../docs/cookbook/#compose-nested-layouts) for a complete example, asset guidance, and the manual-composition alternative.

### Layout variables

Layouts may also export an optional [`vars` variable provider](../../docs/pages/#variable-providers) containing defaults for pages that use the layout:

```ts
export const vars = {
  showSidebar: true,
  pageType: 'article',
}
```

Layout vars are merged into the resolved variable cascade for pages using that layout.
Precedence is:

```txt
page/frontmatter vars > page.vars.* > inner layout vars > outer layout vars > global.vars > domstack defaults
```

This makes layout vars useful for section-wide defaults while still letting individual pages override them.

### Layout render function

A layout's default export is an async or sync function that wraps its `children` in an outer template.
With nested layouts, `children` is the result of the immediately inner layout, or the page itself for the innermost layout.

It is always passed a single object argument with the following entries.
See [Page data and introspection](../../docs/content/#page-data-and-introspection) for details about `page`, and [Global data](../../docs/content/#global-data) for `data`:

- `vars`: The resolved page variable cascade, including domstack defaults, global vars, layout vars, page vars, and page builder vars/frontmatter.
  Pages can customize layouts by overriding global or layout defaults.
- `data`: Only the top-level global-data keys declared by this layout through `vars.dataDeps`.
- `scripts`: array of paths that should be included onto the page in a script tag src with type `module`.
- `styles`: array of paths that should be included onto the page in a `link rel="stylesheet"` tag with the `href` pointing to the paths in the array.
- `children`: The immediate child's render result: the page's content for the innermost layout, or the next inner layout's return value for a parent.
Markdown and HTML pages return strings; TypeScript pages and nested layouts may return other values.
- `page`: An object with metadata and other facts about the current page being rendered into the template.

<a id="the-default-rootlayoutts"></a>

### The default `root.layout.ts`

The default `root.layout.ts` is featured below, and is implemented with [`fragtml`][fragtml], though it could just be done with a template literal or any other template system that runs in Node.js.
See the [`fragtml` docs][fragtml-docs] for escaping, raw HTML, rendering, and fragment usage.

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
  data,
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

If your `src` folder doesn't have a `root.layout.ts` file somewhere in it, `domstack` will use the default [`default.root.layout.js`](https://github.com/bcomnes/domstack/blob/master/lib/defaults/default.root.layout.js) file it ships.
The default `root` layout includes a special boolean variable called `defaultStyle` that lets you disable a default page style (provided by [mine.css](http://github.com/bcomnes/mine.css)) that it ships with.

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
Layout styles are loaded on all pages that use that layout directly or through a `parentLayout` chain.
Layout styles are bundled with [`esbuild`][esbuild] and can bundle relative and `npm` css using css `@import` statements.
DOMStack loads stylesheets in this order: optional defaults, global, outermost-to-innermost layouts, then page.
Under the normal [CSS cascade](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascade/Cascade), later styles take precedence when origin, importance, cascade layer, and specificity are otherwise equal.
This lets page styles override layout styles, and inner layout styles override outer layout styles.


### Layout client bundles

You can create a `${layout-name}.layout.client.ts` next to any layout file.
While the layout file can live anywhere in `src`, the layout client bundles must live next to the associated layout file.

> [!NOTE]
> Use `${layout-name}.layout.client.tsx` when a layout client bundle contains JSX.
You can also use `.jsx`.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions and [`.tsx` client bundles](../../docs/pages/#tsx) for JSX configuration.

```typescript
/* /layouts/article.layout.client.ts */

console.log('I run on every page rendered with the \'article\' layout')

/* This layout client is included in every page rendered with the 'article' layout */
```

Layout client bundles are loaded on all pages that use that layout directly or through a `parentLayout` chain.
Layout client bundles are built with [`esbuild`][esbuild] and can bundle relative and `npm` modules using ESM `import` statements.

### Layout types

Layouts can be typed using `LayoutFunction<T, U, V, D>` where:

- `T` is the variables type
- `U` is the immediate child's render result, from a page or nested layout (defaults to `any`)
- `V` is the layout's return type (defaults to `string` for HTML output)
- `D` is the declared global-data shape (defaults to `Record<string, unknown>`)

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

DOMStack accepts variable providers anywhere variables can be supplied.
A variable provider is an object or a sync/async function that returns an object.

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

- `vars`: An object with the variables of `global.vars.ts`, `page.vars.ts`, layout vars, and any frontmatter or `vars` exports from the page merged together.
- `data`: Only the top-level values selected from [`global.data.ts`](../../docs/content/#global-data) by this renderer's own `dataDeps` declarations.
- `page`: The current page's [`PageInfo` metadata](../../docs/content/#page-metadata).

Template files receive a similar set of variables:

- `vars`: An object with the variables from `global.vars.ts`.
- `data`: Only the top-level values selected from [`global.data.ts`](../../docs/content/#global-data) by the template's `dataDeps` named export.
- `template`: Information about the current template file.

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
