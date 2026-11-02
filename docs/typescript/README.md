---
layout: docs
docsOrder: 100
handlebars: false
---

# TypeScript

Use TypeScript for pages, layouts, data modules, and browser code without adding a separate compilation step.
Node.js strips types from server-side modules, esbuild handles browser bundles, and `tsc` checks types separately.

## Table of Contents

[[toc]]

## Runtime requirements

- Use Node.js 22.22+ within the 22.x release line, or Node.js 24 and newer, as required by DOMStack v12.
  These versions enable type stripping by default; no `NODE_OPTIONS` flag is needed.
- Seamlessly mix `.ts`, `.mts`, `.cts` files alongside `.js`, `.mjs`, `.cjs`.
- No explicit compilation step needed—Node.js handles type stripping at runtime.
- Fully compatible with existing `domstack` file naming conventions.
- Anywhere DOMStack loads JS files, it can now load TS files.

## Supported file types

Anywhere you can use a `.js`, `.mjs`, or `.cjs` file in DOMStack, you can use the corresponding `.ts`, `.mts`, or `.cts` extension.

> [!TIP]
> Prefer the regular `.ts` and `.js` extensions with [`"type": "module"`](https://nodejs.org/api/packages.html#type) in `package.json`.
Use the module-format escape-hatch extensions only when an individual file must override the package's module format.

When running in a Node.js context, [type-stripping](https://nodejs.org/api/typescript.html#type-stripping) is used.
When running in a web client context, [esbuild](https://esbuild.github.io/content-types/#typescript) type stripping is used.
Type stripping provides 0 type checking, so be sure to set up `tsc` and `tsconfig.json` so you can catch type errors while editing or in CI.

## Recommended `tsconfig.json`

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

## Using TypeScript with DOMStack types

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

### Advanced type parameters

The function types also accept parameters for precise vars, content, return, and global-data contracts.
See [Advanced type parameters](../advanced/layout-registry/#advanced-type-parameters) for the parameter reference and custom rendering example, followed by optional registry inference and supplied-var validation.
