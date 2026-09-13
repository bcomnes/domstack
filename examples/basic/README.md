# Basic DOMStack Example with TypeScript

This example demonstrates a fundamental website built with DOMStack using TypeScript, showcasing core features without advanced customization.

## Overview

The basic example illustrates:
- Multiple page types (Markdown, HTML, JavaScript/TypeScript)
- Layout system and page nesting
- Asset handling
- Client-side TypeScript integration
- CSS styling (global and page-specific)
- Variables and metadata
- TypeScript integration with proper type definitions

## Getting Started

### Prerequisites

- Node.js 22.18+ within the 22.x release line, or Node.js 24 or newer

### Installation

```bash
# Install dependencies
npm install
```

### Building the Example

```bash
# Build the site
npm run build

# Watch for changes during development
npm run watch
```

The built site will be in the `public` directory.

## Project Structure

```
src/
├── layouts/             # Layout templates
│   ├── root.layout.ts   # Main layout (TypeScript)
│   └── child.layout.ts  # Nested layout (TypeScript)
├── md-page/             # Markdown page examples
│   ├── page.vars.ts     # Page variables (TypeScript)
│   └── client.ts        # Page-specific client script (TypeScript)
├── js-page/             # JavaScript page examples (kept as JS for demonstration)
│   ├── loose-assets/    # Contains TypeScript files
│   │   ├── page.ts      # TypeScript page
│   │   ├── client.ts    # TypeScript client
│   │   └── shared-lib.ts # TypeScript shared library
├── html-page/           # HTML page examples
│   └── client.ts        # Page-specific client script (TypeScript)
├── global.css           # Global styles
├── global.client.ts     # Global client-side TypeScript
├── global.vars.ts       # Global variables (TypeScript)
└── README.md            # Main content (becomes index.html)
```

### Key Features Demonstrated

### Page Types
- **Markdown pages** - Simple content authoring with frontmatter
- **JavaScript/TypeScript pages** - Dynamic content generation with full JS/TS capabilities
- **HTML pages** - Direct HTML control for complex layouts

### Layouts
The example demonstrates DOMStack's layout system with nested layouts that wrap page content, fully typed with TypeScript interfaces.

### Inferred layout contracts

The [root layout](src/layouts/root.layout.ts) and [child layout](src/layouts/child.layout.ts) register their actual renderer types through the type-only `LayoutRegistry` interface.
The child registration also references `typeof parentLayout`, linking it to root without repeating the parent name in the type declaration.
Both renderers keep explicit `LayoutFunction` annotations so their signatures do not depend recursively on their own registrations.

The [JavaScript page](src/js-page/page.js) uses JSDoc to derive its vars and accepted output from the registered child layout:

```js
/**
 * @import { PageForLayout } from '@domstack/static/types.js'
 */

/** @satisfies {PageForLayout<'child'>} */
```

The `@satisfies` annotation checks the inferred contract while preserving the async function's own Promise return type.
Its [page.vars.js](src/js-page/page.vars.js) still selects `child` at runtime.
The page returns a `HtmlResult`, child converts that into a string, and root wraps the result into the final document.
The registry checks this chain without requiring the page to import `PageVars` or repeat `HtmlResult` in its annotation.
The [loose-assets TypeScript page](src/js-page/loose-assets/page.ts) similarly uses `PageForLayout<'root'>` for its default root layout.

Registration does not supply missing vars or replace runtime layout selection.
`siteName` still comes from global vars, and each page supplies its title.
The example's TypeScript program includes both `.ts` and `.js` files, so `npm test` checks the JSDoc consumer as well as the TypeScript consumer.
Keep each site's registry in its own TypeScript program to avoid name collisions with other sites.

When working from this repository checkout, build the package declarations before checking the example, and clean them afterward:

```sh
# Run from the repository root
npm run build:declaration
npm --workspace @domstack/basic-example test
npm --workspace @domstack/basic-example run build
npm run clean:declarations-top
npm run clean:declarations-lib
```

### Assets
Static assets like images are co-located with content and automatically copied to the output directory.

### Styling
Both global and page-specific CSS is demonstrated, showing how to scope styles appropriately.

### TypeScript Integration
- **Strong typing** - Full TypeScript support with interfaces for layouts, pages, and components
- **JSDoc example** - The js-page directory is kept as JavaScript with JSDoc comments to demonstrate compatibility
- **Type definitions** - Proper type definitions for page variables, layout functions, and client scripts

## Learn More

This is one of several examples in the DOMStack repository. For more advanced features, check out the other examples like:
- css-modules
- fragtml
- tailwind
- and more...

For complete documentation, visit the [DOMStack GitHub repository](https://github.com/bcomnes/domstack).
