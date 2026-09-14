---
layout: docs
docsOrder: 30
handlebars: false
---

# Pages

A page combines source content with a layout, variables, and optional browser assets.
This guide explains how to arrange those files and how DOMStack turns them into HTML at matching URLs.

## Table of Contents

[[toc]]

## Page files

Pages are named directories inside `src` with **one of** the following page files:

- `md` pages are [CommonMark](https://commonmark.org) markdown pages, with an optional [YAML](https://yaml.org) front-matter block.
- `html` pages are an inner [HTML](https://developer.mozilla.org/en-US/docs/Web/HTML) fragment that get inserted into the page layout.
- `ts` pages are [TypeScript](https://developer.mozilla.org/en-US/docs/Glossary/TypeScript) files that export a default function that resolves into an inner HTML fragment inserted into the page layout.

> [!NOTE]
> A **source-backed page** is discovered directly from a page file in `src`, rather than created by a `*.pages.ts` module.
Source-backed pages exist before `global.data.ts` and [Generated pages](../generation/#generated-pages) run.

Variables are available in all pages.
`md` and `html` pages support variable access via [handlebars][hb] template blocks.
`ts` pages receive variables as part of the argument passed to them.
See the [Variables](../../docs/pages/#variables) section for more info.

Pages can define a special variable called [`layout`](../layouts/#selecting-a-layout) that determines which layout the page is rendered into.

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

## Additional outputs

Source-backed pages can publish extra files alongside their normal HTML through a named `additionalOutputs` export.
Use a [layout hook](../layouts/#additional-outputs) for shared policy, a JS/TS page-module hook for executable pages, or the page's directly associated vars companion for page-specific Markdown, HTML, or JS/TS behavior.
The hook declares files; it must not write directly to the destination.

```js
// src/article/page.js
export const vars = {
  title: 'An article',
  dataDeps: ['siteMetadata'],
}

export default ({ vars }) => `<h1>${vars.title}</h1>`

export const additionalOutputs = ({ vars, data }) => ({
  outputName: './metadata.json',
  content: JSON.stringify({ title: vars.title, site: data.siteMetadata }),
})
```

### Companion hooks

The existing vars companion can export the same named hook without changing its default vars export:

```js
// src/article/page.vars.js (alongside page.md)
export default { title: 'An article' }

export async function* additionalOutputs ({ page, vars }) {
  yield {
    outputName: './source.md',
    content: await page.readMarkdownContent(),
  }
  yield {
    outputName: './metadata.json',
    content: JSON.stringify({ title: vars.title }),
  }
}
```

For HTML and JS/TS companions, return suitable text or JSON instead of calling `readMarkdownContent()`.
The hook is a named module export, not a property of resolved vars or executable Markdown frontmatter.
Only the directly associated companion provides a page-level hook; global vars and inherited directory vars do not provide hooks.
If both a JS/TS page module and its companion export `additionalOutputs`, the build fails with a provider-conflict error identifying both modules.
Choose one provider rather than relying on precedence.

### Hook arguments and results

Every hook receives `{ page, vars, data }`:

- `page` is a read-only handle to the current source page, including `type`, `path`, `url`, `outputName`, `outputRelname`, `draft`, and read-only `pageFile` metadata.
  Its `readMarkdownContent()` method reads the Markdown body with YAML frontmatter removed, without rendering Markdown, substituting Handlebars, or rewriting links.
  The method throws for non-Markdown pages.
  The handle does not expose rendering methods, output-writing methods, or another consumer's data.
- `vars` contains the fully resolved page variables and is read-only.
- `data` contains only the declaring renderer's subscribed global data.
  Page-module and companion hooks share the page renderer's subscriptions; each layout hook shares that specific layout renderer's subscriptions.
  Declare these with the existing static `vars.dataDeps` array convention, or `dataDeps` in the companion's default vars object.
  There is no `additionalOutputsDataDeps` export, and undeclared keys are not implicitly available.
  See [Data subscriptions](../data/#data-subscriptions).

A hook returns one explicit `{ outputName: string, content: string }` record, an array of records, or an async iterable of records, directly or through a promise.
Only string content is supported; serialize JSON yourself.
Bare strings are invalid because there is no implicit filename.
An empty array or an async iterator that yields nothing declares no files for that hook.

Applicable hooks execute in outermost layout → innermost layout → page order, and all their outputs are additive.
Returning `[]` from the page hook does not suppress layout outputs.
For an application-specific opt-out, have the layout inspect a resolved variable such as `rawExport: false` and return `[]` itself.
Hooks run only in the owning page's output-build phase, not when collection or global-data code calls `renderInnerPage()` or `renderFullPage()`.
Generated `*.pages.*` pages skip additional-output hooks entirely, including inherited layout hooks.

### Output paths and failures

Output names resolve beneath the configured destination, including custom destinations:

| Output name | Resolution for a page at `docs/article/index.html` |
| --- | --- |
| `metadata.json` or `./metadata.json` | `docs/article/metadata.json` |
| `../source/article.md` | `docs/source/article.md` |
| `/raw/article.md` | `raw/article.md` at the destination root |

A leading `/` means destination-root-relative, never filesystem-absolute.
Relative paths use the current page's output directory even when a layout declares them.
Parent traversal is allowed only while the resolved target remains inside the destination.
Escapes and invalid file targets fail the build.
These rules do not change existing template output-path semantics.

Duplicate destinations produce best-effort warnings based on build output reports, including exact duplicates between hooks and conflicts with normal HTML, other pages, templates, copied assets, or bundles.
They do not reject the build, even when content differs.
Watch warnings only compare outputs observed in the current page/template phase; this is not a persistent cross-build conflict registry or a case-alias check.
Choose unique destinations; do not rely on write order or cleanup behavior for conflicting outputs.

DOMStack renders a page and collects and validates all its hook results before writing that page's HTML and additional files directly to the destination.
If rendering, a hook, an iterator, or output validation fails, that owning page's existing HTML and sidecars remain unchanged.
An iterator that throws after yielding records therefore does not write those earlier yields.
Other pages and build phases may already have written their outputs; there is no whole-build or page-phase isolation, and filesystem write failures can leave partial updates.

### Watch behavior and ownership

Additional files belong to the source page and appear in page build reports and the build manifest.
Ownership tracking and cleanup also work when public build-manifest generation is disabled.
After a successful rebuild, DOMStack removes previously owned files no longer returned, including renamed outputs and files from removed hooks.
Source deletion, source rename, or draft exclusion also removes the page's old outputs.
Adding, editing, removing, or renaming a companion updates the owning page's hook and output set.

Hooks rerun when the owning page rebuilds, including changes to applicable page or layout data subscriptions.
A dependency used only by a hook still triggers an HTML rebuild because both outputs rebuild together.
Byte-identical additional files are not rewritten in the live destination, but remain in the complete owned output set.
An article body edit can update that article's HTML and raw export without invalidating sibling raw exports; a shared navigation rebuild can rerun all affected hooks without changing unchanged raw-file mtimes.
Keep collection-wide search indexes and feeds in templates, while using these hooks for per-page artifacts.

## Draft pages

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

## Variables

Variables combine site-wide defaults with layout and page overrides.
The precedence is page/frontmatter vars, page variable files, inner-to-outer layout vars, global vars, then DOMStack defaults.
See [Settings](../settings/#global.vars.ts) for global defaults and [Layouts](../layouts/#layout-variables) for layout defaults.

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
- `data`: Only the top-level values selected from [`global.data.ts`](../data/#global-data) by this renderer's own `dataDeps` declarations.
- `page`: The current page's [`PageInfo` metadata](../data/#page-metadata).

Template files receive a similar set of variables:

- `vars`: An object with the variables from `global.vars.ts`.
- `data`: Only the top-level values selected from [`global.data.ts`](../data/#global-data) by the template's `dataDeps` named export.
- `template`: Information about the current template file.

[fragtml]: https://www.npmjs.com/package/fragtml
[preact]: https://preactjs.com/
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
