---
layout: docs
docsOrder: 130
docsParent: /docs/advanced/
handlebars: false
---

# Layout registry and type contracts

Use explicit type parameters to describe renderer inputs and outputs, then optionally register layouts to infer compatible chains and validate supplied vars.
These are type-only contracts; [Layouts](../../layouts/) describes runtime discovery and nesting, [TypeScript](../../typescript/) covers setup and basic annotations, and [Generation](../../generation/) covers generated-page exports.

## Table of Contents

[[toc]]

## Advanced type parameters

`PageFunction`, `LayoutFunction`, `TemplateFunction`, and `PagesFunction` support additional type parameters for precise input, data, and return type control:

**PageFunction<T, U, D>**

- `T` - The type of variables passed to the page (required)
- `U` - The return type of the page function (optional, defaults to `any`)
- `D` - The declared global-data shape (optional, defaults to `Record<string, unknown>`)

**LayoutFunction<T, U, V, D>**

- `T` - The type of variables passed to the layout (required)
- `U` - The type of content received from pages as `children` (optional, defaults to `any`)
- `V` - The return type of the layout function (optional, defaults to `string`)
- `D` - The declared global-data shape (optional, defaults to `Record<string, unknown>`)

**TemplateFunction<T, D>**

- `T` - The global vars passed to the template (required)
- `D` - The declared global-data shape (optional, defaults to `Record<string, unknown>`)

**PagesFunction<T, U, V, D, P>**

- `T` - The vars added to generated pages (optional, defaults to `Record<string, any>`)
- `U` - The static children or inline page-function return type (optional, defaults to `string`)
- `V` - The default and global vars received by the pages factory (optional, defaults to `Record<string, any>`)
- `D` - The factory's declared global-data shape (optional, defaults to `Record<string, unknown>`)
- `P` - Inline pages' declared global-data shape (optional, defaults to `D` for convenience; set it independently when factory and page subscriptions differ)

Each layout's input, output, and data types are independent of its parent and page.
Without the registry helpers below, runtime layout-name resolution does not statically prove that two separately declared layout modules have compatible content types.
Manual function calls do receive normal TypeScript argument checking.

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

## Inferring registered layout chains

TypeScript projects can optionally register layouts through module augmentation.
Registry helpers require `strictNullChecks: true` in the site's TypeScript configuration (`strict: true` enables it unless explicitly overridden).
Without it, TypeScript cannot distinguish optional or nullish contracts reliably, so chain-dependent registry helpers consistently resolve to `never`.
The existing explicit `LayoutFunction`, `PageFunction`, `GeneratedPageDefinition`, and `PagesFunction` APIs remain available without this setting.
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

### Registry helpers

The registry helpers are:

| Type | Result |
| --- | --- |
| `LayoutRegistryName` | Registered names in the current TypeScript program. |
| `LayoutChain<Name>` | Names from the outermost to innermost layout. |
| `LayoutProvidedVars<Name>` | Layout defaults merged outer-to-inner with shallow override semantics, excluding `dataDeps` metadata. |
| `LayoutRequiredVars<Name>` | Required renderer vars not definitely supplied by layout defaults. |
| `LayoutChainVars<Name, GlobalVars, PageVars>` | Final known vars after global, layout, and page override precedence. |
| `LayoutPageOutput<Name>` | Children type accepted by the innermost layout. |
| `LayoutResult<Name>` | Awaited output of the outermost renderer, before DOMStack converts it to the final HTML string. |
| `PageForLayout<Name, PageVars, Data, GlobalVars>` | A `PageFunction` with inferred vars and page output. `Data` remains the page's own data contract and never includes layout data. |
| `PageOutputsForRenderer<Renderer>` | A page-output hook deriving vars and the renderer's own data contract, with a restricted read-only page handle. |
| `ValidatePageVars<Name, PageVars, GlobalVars>` | The original supplied `PageVars` if actual known sources satisfy every renderer, otherwise `never`. |
| `GeneratedPageForLayout<Name, PageVars, Data, GlobalVars>` | A strictly checked generated definition with supplied vars, a required literal layout selector, and correctly typed static or inline children. |
| `PagesForLayout<Name, PageVars, GlobalVars, FactoryData, PageData>` | A factory or async generator producing checked definitions, with separate factory and inline-page data contracts. |

These types describe contracts; they do not supply missing values or select a layout at runtime.
Required vars without registered defaults still need a global, page, or builder source.
Use `LayoutRequiredVars` to inspect those obligations; the global-vars type above assumes a matching global vars export.
For union-shaped defaults, a renderer alternative may be satisfied differently by each defaults branch; the helper reports only obligations needed across all possible branches.
For example, when both renderer vars and defaults are `{ a: string } | { b: number }`, nothing remains required externally, so `LayoutRequiredVars` is `{}`.
If different defaults branches leave different fields missing, the external vars must cover every branch rather than just one.
`LayoutVars<T>` retains its existing meaning as the type of a layout vars export.
Registry-provided, required, and renderer vars exclude the reserved `dataDeps` property; it stays in raw exports for subscription handling but is not passed to renderers.
A renderer that requires `vars.dataDeps` is incompatible with that runtime boundary, and global vars containing `dataDeps` are rejected just as they are at runtime.

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

### Page-output hook contracts

Use `PageOutputsForRenderer<typeof layoutRenderer>` to derive a hook's resolved vars and own subscribed data contract from an explicitly typed layout renderer, or `PageOutputsForRenderer<ArticlePage>` for a page renderer type such as the one above.
This helper reuses the renderer's vars and data types but keeps the hook's restricted page handle; it does not combine data from other renderers or create runtime subscriptions.
When a layout renderer declares only a subset of the fully resolved page vars, the derived hook type exposes only that declared contract.
For example, alongside the `ArticlePage` renderer above:

```ts
import type { PageOutputsForRenderer } from '@domstack/static/types.js'

export const pageOutputs: PageOutputsForRenderer<ArticlePage> = ({ page, vars, data }) => ({
  outputName: './article.json',
  content: JSON.stringify({ title: vars.title, url: page.url, body: data.articleBody }),
})
```

See [Page outputs](../page-outputs/) for the hook arguments, return values, path rules, and watch behavior.

## Validating supplied page vars

`PageForLayout` describes a renderer contract but does not prove that your exports supply all required vars.
Use `ValidatePageVars` at the export boundary for that stronger check:

```ts
import type { ValidatePageVars } from '@domstack/static/types.js'
import type globalVars from './global.vars.ts'

const supplied = {
  layout: 'article' as const,
  title: 'My article',
}

export const vars = supplied satisfies ValidatePageVars<
  'article',
  typeof supplied,
  Awaited<ReturnType<typeof globalVars>>
>
```

For the registered layouts above, this succeeds if the global provider supplies `siteName`; the article layout supplies `showSidebar`.
Removing `title` from `supplied`, or omitting `siteName` from the globals, makes the validation type `never` and the export fails to type-check.
The local `supplied` binding avoids circular inference from checking `typeof vars` within its own initializer.
JavaScript can use the equivalent `@satisfies {ValidatePageVars<...>}` annotation on `export const vars = supplied`.

Validation uses only actual known sources, without adding renderer requirements as assumed values.
It merges global vars, outer-to-inner layout defaults, and the supplied page vars, then checks the final object against every renderer.
`dataDeps` stays in the original page export but is stripped from page/layout vars during validation, matching runtime subscription handling; global vars must not contain `dataDeps`.
The generic inputs are resolved object types, so use `Awaited<ReturnType<typeof provider>>` for function exports.
If page vars and frontmatter are separate sources, pass their final shallow-merged shape; TypeScript does not inspect frontmatter automatically.
Built-in defaults are not inferred automatically: include any relied-on built-ins in the known effective global-vars type.

The name selects the chain to validate, not the runtime layout: keep the actual `layout` export consistent with it.
These checks cannot prove the accuracy of manually asserted types or validate arbitrary dynamic modules.
[Registry-aware generated definitions](#registered-layouts-for-generated-pages) additionally require a matching literal `vars.layout` and validate supplied vars automatically.

## Registered layouts for generated pages

For a [registered layout chain](#inferring-registered-layout-chains), use `GeneratedPageForLayout<Name, PageVars, PageData, GlobalVars>` for a definition or `PagesForLayout<Name, PageVars, GlobalVars, FactoryData, PageData>` for a factory.
These helpers validate required vars from actual known sources, rather than assuming values exist because a renderer requires them.
`PageVars` describes only what each definition supplies; inline renderers receive the merged globals, layout defaults, and page vars.

For the registered `article` layout above, which accepts string content and defaults `showSidebar`, a single definition can be typed as follows:

```ts
import type { GeneratedPageForLayout } from '@domstack/static/types.js'
import type globalVars from './global.vars.ts'

type GlobalVars = Awaited<ReturnType<typeof globalVars>>

type ArticleDefinition = GeneratedPageForLayout<
  'article',
  { title: string },
  Record<string, never>,
  GlobalVars
>

const article: ArticleDefinition = {
  outputName: 'article/index.html',
  vars: { layout: 'article', title: 'Generated article' },
  children: ({ vars }) => vars.showSidebar ? '<p>With sidebar</p>' : '<p>No sidebar</p>',
}

export default article
```

The actual global provider must supply `siteName`, as required by the registered root renderer.
The definition supplies neither `siteName` nor `showSidebar`, but its inline renderer can access both.
Its `vars` property is required and must contain the literal `layout: 'article'`, even when a global default would select the same layout.
A missing title, incompatible override, wrong selector, or incompatible children produces a type error.

Factories keep their own inputs separate from each generated page:

```ts
import type { DataDeps, PagesForLayout } from '@domstack/static/types.js'
import type globalVars from './global.vars.ts'

type GlobalVars = Awaited<ReturnType<typeof globalVars>>
type FactoryData = { articleTitles: string[] }
type InlineData = { announcement: string }
type SuppliedVars = {
  title: string
  dataDeps: DataDeps<InlineData>
}

export const dataDeps = ['articleTitles'] satisfies DataDeps<FactoryData>

const articles: PagesForLayout<
  'article', SuppliedVars, GlobalVars, FactoryData, InlineData
> = async function * ({ vars: globals, data: factoryData }) {
  for (const [index, title] of factoryData.articleTitles.entries()) {
    yield {
      outputName: `articles/${index}/index.html`,
      vars: { layout: 'article', title, dataDeps: ['announcement'] },
      children: ({ vars, data }) => {
        // vars contains siteName, title, and showSidebar, but not dataDeps.
        // data contains announcement, not articleTitles or layout subscriptions.
        return `${globals.siteName}: ${vars.title} — ${data.announcement}`
      },
    }
  }
}

export default articles
```

Here the factory sees only effective global vars and its own subscribed data, not layout defaults or page vars.
The inline page receives its own data contract; `FactoryData` and `PageData` default independently and do not inherit from each other.
The global-data provider must produce both declared data keys; supplying type arguments does not create subscriptions.
Escape interpolated content with your template library when producing HTML from untrusted values.

Factories can return one definition, an array, an async iterable, `null`, or `undefined`, directly or through a promise.
`PagesForLayout` intentionally uses a conservative definition-only array envelope: its array entries must be definitions, not promises.
This is a type-level restriction, not a runtime limitation: `iterateGeneratedPageDefinitions` consumes arrays with `for await`, awaiting promise entries before validation.
Resolve promised definitions before returning an array to satisfy the helper, or use an async generator to yield resolved definitions incrementally.
Nullish placeholders are invalid entries even though a nullish top-level result produces no pages.
Use a union of individually checked `GeneratedPageForLayout` types for heterogeneous collections; a single `PagesForLayout` checks one literal selected layout.
The existing explicit `GeneratedPageDefinition` and `PagesFunction` APIs remain available for dynamic or unregistered layouts.

Children follow the runtime boundary:

- Static content must match the innermost layout's accepted children type.
- Omitted, `undefined`, or static `null` content becomes an empty string, so these forms are allowed only when that layout accepts `''`.
- Inline renderer results are awaited and then passed through unchanged, including nullish values; a layout accepting only `null` therefore needs `children: () => null`, not static `null`.
- Static callable and thenable objects are not supported by this strict helper; use an inline renderer so invocation and awaiting are explicit.
- Static objects reserve `call`, `apply`, `bind`, and `then` properties to avoid accidentally accepting functions or promises through structural object compatibility.
- To pass a function as a child's render value, wrap it in an inline renderer that returns the function.

See the [basic example's generated guides](https://github.com/bcomnes/domstack/blob/master/examples/basic/src/guides.pages.ts) for static and async inline content using the same registered chain.
