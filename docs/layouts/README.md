---
layout: docs
docsOrder: 40
handlebars: false
---

# Layouts

Layouts wrap page content in shared HTML and can contribute variables, data subscriptions, styles, and browser code.
Use a single root layout for a simple site, or declare parent layouts to share structure across sections.
For a complete working example, see [Compose nested layouts](../cookbook/nested-layouts/).

## Table of Contents

[[toc]]

## Selecting a layout

Layouts are "outer page templates" that pages get rendered into.
You can define as many as you want, and they can live anywhere in the `src` directory.

Layouts are named `${layout-name}.layout.ts` where `${layout-name}` becomes the name of the layout.
Layouts should have a unique name, and layouts with duplicate names result in a build error.

> [!NOTE]
> Wherever you see `.layout.ts` being used, you can also use `.layout.js`.
Type checking is supported in both file types.
See [Supported file types](../typescript/#supported-file-types) for all available extensions.

Example layout file names:

```bash
src/layouts/root.layout.ts # this layout is referenced as 'root'
src/other-layouts/article.layout.ts # this layout is referenced as 'article'
```

DOMStack ships a default `root` layout, so defining one in your `src` directory is optional, though recommended.
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

## Layout module exports

DOMStack recognizes these exports from a layout module:

| Export | Required | Contract |
| --- | --- | --- |
| `default` | Yes | A synchronous or asynchronous [layout render function](#layout-render-function). |
| `vars` | No | An object, or a sync/async function returning an object, providing [layout defaults](#layout-variables). |
| `parentLayout` | No | A non-empty string naming the immediate outer layout; see [Declaring nested layouts](#declaring-nested-layouts). |
| `pageOutputs` | No | A build-only function returning [extra files for each source page](../pages/#page-outputs), such as Markdown downloads or JSON metadata. |

## Declaring nested layouts

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

Each layout can also declare its own [global-data subscriptions](../data/#data-subscriptions) through `vars.dataDeps`.
DOMStack passes only those declared keys to that layout's `data` argument; a child does not receive its parent's data or need to repeat its declarations.
For rebuilds, the page depends on the union of its own subscriptions and every layout's subscriptions in the declared chain.
See [Data subscriptions in nested layouts](../cookbook/nested-layouts/#data-subscriptions-in-nested-layouts) for typed declarations and examples.

See [Compose nested layouts](../cookbook/nested-layouts/) for a complete example and asset guidance.

## Page outputs

Export `pageOutputs` from a layout to produce extra files for each source-backed page that uses it.
This is the same export used by page modules and vars companions, and it receives `{ page, vars, data }`.
The function runs for each page, and that page owns the returned files.
For example, a documentation layout can publish a Markdown download alongside each rendered page:

```js
// src/docs.layout.js
export default ({ children }) => children

export async function pageOutputs ({ page, vars }) {
  if (page.type !== 'md' || vars.rawExport === false) return []
  return {
    outputName: page.outputName.replace(/\.html$/, '.source.md'),
    content: await page.readMarkdownContent(),
  }
}
```

The filename is relative to the current page's output directory, not the layout directory.
Using the page's HTML filename helps keep destinations unique when several loose Markdown pages share a directory.
Exact duplicate destinations produce best-effort build warnings, not an override contract; avoid sharing output paths between pages or hooks.
Set `rawExport: false` in a page's frontmatter or vars to opt out of this layout's Markdown download.
Returning `[]` from a page hook does not suppress layout files; the layout itself must check the opt-out variable.

Nested hooks run outermost layout → innermost layout → selected page-level hook, and their files are additive.
If a JS/TS page module and its vars companion both export `pageOutputs`, the page module's hook wins with a warning; layout hooks still run.
Each layout hook receives the fully resolved page `vars` and only that layout renderer's `vars.dataDeps` subscriptions in `data`.
Declare data needed by the hook in the same subscriptions used by the layout render function.

Hooks may return a `{ outputName, content }` record, an array of records, or an async iterable of records, directly or through a promise.
DOMStack validates and processes each file before requesting the next record, writing it or retaining an unchanged file during watch rebuilds.
A later hook runs only after the preceding hook's files have been processed.
Files are written directly, without transactions or rollback; if a later record or hook fails, earlier writes remain in the destination.
Watch mode tracks these files for cleanup after a successful rebuild or source removal.
Support for generated `*.pages.*` pages is deferred; they skip these hooks, including inherited layout hooks.
See [Page outputs](../pages/#page-outputs) for the complete arguments, public types, path rules, and watch behavior.

## Layout variables

Layouts may also export an optional [`vars` variable provider](../pages/#variable-providers) containing defaults for pages that use the layout:

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

## Layout render function

A layout's default export is an async or sync function that wraps its `children` in an outer template.
With nested layouts, `children` is the result of the immediately inner layout, or the page itself for the innermost layout.

It is always passed a single object argument with the following entries.
See [Page data and introspection](../data/#page-data-and-introspection) for details about `page`, and [Global data](../data/#global-data) for `data`:

- `vars`: The resolved page variable cascade, including domstack defaults, global vars, layout vars, page vars, and page builder vars/frontmatter.
  Pages can customize layouts by overriding global or layout defaults.
- `data`: Only the top-level global-data keys declared by this layout through `vars.dataDeps`.
- `scripts`: array of paths that should be included onto the page in a script tag src with type `module`.
- `styles`: array of paths that should be included onto the page in a `link rel="stylesheet"` tag with the `href` pointing to the paths in the array.
- `children`: The immediate child's render result: the page's content for the innermost layout, or the next inner layout's return value for a parent.
Markdown and HTML pages return strings; TypeScript pages and nested layouts may return other values.
- `page`: An object with metadata and other facts about the current page being rendered into the template.

## The default `root.layout.ts`

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

## Layout styles

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
See [Global bundles](../global-bundles/#optional-cascade-layers) for optional cascade-layer conventions.

## Layout client bundles

You can create a `${layout-name}.layout.client.ts` next to any layout file.
While the layout file can live anywhere in `src`, the layout client bundles must live next to the associated layout file.

> [!NOTE]
> Use `${layout-name}.layout.client.tsx` when a layout client bundle contains JSX.
You can also use `.jsx`.
See [Supported file types](../typescript/#supported-file-types) for all available extensions and [`.tsx` client bundles](../pages/#.tsx) for JSX configuration.

```typescript
/* /layouts/article.layout.client.ts */

console.log('I run on every page rendered with the \'article\' layout')

/* This layout client is included in every page rendered with the 'article' layout */
```

Layout client bundles are loaded on all pages that use that layout directly or through a `parentLayout` chain.
Layout client bundles are built with [`esbuild`][esbuild] and can bundle relative and `npm` modules using ESM `import` statements.

## Layout types

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

### Inferring registered layout chains

TypeScript projects can optionally register layouts through module augmentation.
The registry is type-only: it does not replace filesystem discovery, create runtime imports, or change DOMStack's runtime validation.
Annotate each renderer with the existing explicit `LayoutFunction` API first, then register the actual exports with `typeof` so the renderer does not recursively depend on its own registry entry.

```ts
// root.layout.ts
import type { LayoutFunction } from '@domstack/static/types.js'

export type RootVars = {
  siteName: string
  title: string
}

export type Frame = { html: string }

const rootLayout: LayoutFunction<RootVars, Frame, string> = ({ children }) => {
  return `<!doctype html><html><body>${children.html}</body></html>`
}

export default rootLayout

declare module '@domstack/static/types.js' {
  interface LayoutRegistry {
    root: {
      render: typeof rootLayout
    }
  }
}
```

```ts
// article.layout.ts
import type { LayoutFunction } from '@domstack/static/types.js'
import type { Frame, RootVars } from './root.layout.ts'

export const parentLayout = 'root'
export const vars = { showSidebar: true }

export type ArticleVars = RootVars & {
  showSidebar: boolean
}

const articleLayout: LayoutFunction<ArticleVars, string, Frame> = ({ children }) => ({
  html: `<article>${children}</article>`,
})

export default articleLayout

declare module '@domstack/static/types.js' {
  interface LayoutRegistry {
    article: {
      parentLayout: typeof parentLayout
      vars: typeof vars
      render: typeof articleLayout
    }
  }
}
```

A page can then derive its renderer contract from the selected innermost layout:

```ts
import type { DataDeps, PageForLayout } from '@domstack/static/types.js'

type PageData = { articleBody: string }

export const vars = {
  layout: 'article',
  title: 'My article',
  dataDeps: ['articleBody'] satisfies DataDeps<PageData>,
}

type ArticlePage = PageForLayout<
  'article',
  typeof vars,             // page/frontmatter/builder vars known here
  PageData,                // this page's data only
  { siteName: string }      // global vars known here
>

const page: ArticlePage = ({ vars, data }) => {
  vars.siteName
  vars.title
  vars.showSidebar
  data.articleBody
  return '<p>Article body</p>'
}

export default page
```

The registry helpers are:

| Type | Result |
| --- | --- |
| `LayoutRegistryName` | Registered names in the current TypeScript program. |
| `LayoutChain<Name>` | Names from the outermost to innermost layout. |
| `LayoutProvidedVars<Name>` | Layout defaults merged outer-to-inner with shallow override semantics. |
| `LayoutRequiredVars<Name>` | Required renderer vars not definitely supplied by layout defaults. |
| `LayoutChainVars<Name, GlobalVars, PageVars>` | Final known vars after global, layout, and page override precedence. |
| `LayoutPageOutput<Name>` | Children type accepted by the innermost layout. |
| `LayoutResult<Name>` | Awaited output of the outermost renderer, before DOMStack converts it to the final HTML string. |
| `PageForLayout<Name, PageVars, Data, GlobalVars>` | A `PageFunction` with inferred vars and page output. `Data` remains the page's own data contract and never includes layout data. |

These types describe contracts; they do not supply missing values or select a layout at runtime.
Required vars without registered defaults still need a global, page, or builder source.
Use `LayoutRequiredVars` to inspect those obligations; the global-vars type above assumes a matching global vars export.
`LayoutVars<T>` retains its existing meaning as the type of a layout vars export.

The helpers await each layout's return type and verify it is accepted by the immediate parent.
They also reject statically known incompatible vars overrides.
Unknown names, missing parents, cycles, widened or union parent names, malformed entries, incompatible renderer boundaries, and chains deeper than 32 layouts resolve to `never`.
DOMStack still performs runtime checks because Markdown frontmatter, dynamic modules, and JavaScript values are not guaranteed by TypeScript.
The selected name must be a single string literal; a union of selected names also resolves to `never` rather than accepting a page that only works for one alternative.
Use the existing `LayoutFunction` and `PageFunction` APIs for unregistered layouts or dynamic/union layout selections.
Explicit `any` contracts, generic renderers, and overloaded functions can reduce inference precision; prefer concrete `LayoutFunction` annotations for registered renderers.

Registry declarations are global to one TypeScript program.
Use one program per site or site-specific layout names when several sites share a program, otherwise common names such as `root` can collide.
Every file containing an augmentation must be included by that site's `tsconfig.json`.

JavaScript/JSDoc projects can opt in with an included companion declaration file:

```ts
// src/layout-registry.d.ts
import type rootLayout from './layouts/root.layout.js'
import type articleLayout from './layouts/article.layout.js'
import type { parentLayout, vars } from './layouts/article.layout.js'

declare module '@domstack/static/types.js' {
  interface LayoutRegistry {
    root: {
      render: typeof rootLayout
    }
    article: {
      parentLayout: typeof parentLayout
      vars: typeof vars
      render: typeof articleLayout
    }
  }
}
```

These imports are erased and do not become runtime or watch dependencies.

## Custom layout renderers

DOMStack's bundled default layout uses [`fragtml`][fragtml] because the default template only needs safe string manipulation.
You can eject or replace that layout with any Node-compatible renderer that returns an HTML string.
The previous incumbent for this job was `htm/preact` with [`preact-render-to-string`](https://github.com/preactjs/preact-render-to-string).
That is still a good fit when your Node-side pages or layouts produce Preact VNodes, or when you want the same component model on the server and in browser bundles.
If you also want Preact or React in browser JSX/TSX bundles, configure that separately as described in [`.tsx`](../pages/#.tsx).

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
> `rawHtml()` bypasses HTML escaping and is equivalent to setting `innerHTML` directly.
Only use it with trusted HTML that you generated or sanitized yourself, such as the output of `await page.renderInnerPage()` or a trusted Markdown renderer.
`children` passed to a layout can be any type returned by a page function and may contain unsanitized content; always verify its source before passing it to `rawHtml()`.

[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[esbuild]: http://esbuild.github.io
