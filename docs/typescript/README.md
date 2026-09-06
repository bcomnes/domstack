---
layout: docs
handlebars: false
---

# TypeScript reference

## Table of Contents

[[toc]]

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
> Prefer the regular `.ts` and `.js` extensions with [`"type": "module"`](https://nodejs.org/api/packages.html#type) in `package.json`.
Use the module-format escape-hatch extensions only when an individual file must override the package's module format.

When running in a Node.js context, [type-stripping](https://nodejs.org/api/typescript.html#type-stripping) is used.
When running in a web client context, [esbuild](https://esbuild.github.io/content-types/#typescript) type stripping is used.
Type stripping provides 0 type checking, so be sure to set up `tsc` and `tsconfig.json` so you can catch type errors while editing or in CI.

<a id="recommended-tsconfigjson"></a>

### Recommended `tsconfig.json`

Install [@voxpelli/tsconfig](https://ghub.io/@voxpelli/tsconfig), which enables type checking in `.js` and `.ts` files and configures TypeScript for `--noEmit`.
Extend its Node.js 22 baseline with DOMStack's type-stripping and client-TSX settings:

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

You can use `domstack`'s built-in types to strongly type your layout, page, and template functions.
Runtime values are imported from `@domstack/static`; types are imported from the dedicated `@domstack/static/types.js` entry.
The following types are available:

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
> Use `PageFunction`, `LayoutFunction`, `TemplateFunction`, and `GlobalDataFunction` for ordinary synchronous or asynchronous implementations.
> Their `Async*` variants are available when a type must specifically require a promise return value, including JSDoc annotations directly on async functions.
> `PagesFunction` supports normal functions, `async` functions, and async generators.

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
DOMStack resolves layout names at runtime, so it cannot statically prove that two separately declared layout modules have compatible content types.
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

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
