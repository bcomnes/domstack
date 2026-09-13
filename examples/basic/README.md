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
 * @import { default as globalVars } from '../global.vars.ts'
 */

/** @satisfies {PageForLayout<'child', typeof vars, Record<string, never>, Awaited<ReturnType<typeof globalVars>>>} */
```

The `@satisfies` annotation checks the inferred contract while preserving the async function's own Promise return type.
Its [page.vars.js](src/js-page/page.vars.js) still selects `child` at runtime.
The page returns a `HtmlResult`, child converts that into a string, and root wraps the result into the final document.
The registry checks this chain without requiring the page to import `PageVars` or repeat `HtmlResult` in its annotation.
The [loose-assets TypeScript page](src/js-page/loose-assets/page.ts) similarly uses `PageForLayout<'root', typeof vars, Record<string, never>, Awaited<ReturnType<typeof globalVars>>>` for its default root layout.
Both pages reference actual exports for their own vars and resolved async global vars, while the registry supplies layout defaults and renderer requirements.
`Record<string, never>` explicitly states that these pages subscribe to no global data; global vars and subscribed data are separate concepts.

Registration does not supply missing vars or replace runtime layout selection.
`siteName` and `locale` still come from global vars, and each page supplies its title.
The example's TypeScript program includes both `.ts` and `.js` files, so `npm test` checks the JSDoc consumer as well as the TypeScript consumer.
Keep each site's registry in its own TypeScript program to avoid name collisions with other sites.

#### A visible variable cascade

The two pages render their inferred variables so the type-level composition can be compared with the built HTML:

| Variable | Global vars | Root defaults | Async child defaults | JavaScript page | Final JavaScript page type/value |
| --- | --- | --- | --- | --- | --- |
| `theme` | `'dark'` | `'light'` | `'dark'` | `'light'` | `'light'` |
| `locale` | `'en'` | — | — | — | `'en'` |
| `navigation` | Array of `{ label, href }` | — | — | — | Typed navigation entries |
| `footer` | — | `{ label: 'Built with DOMStack', showYear: false }` | — | — | Inherited typed object |
| `readingMinutes` | — | — | `4` | — | `number`, value `4` |
| `badge` | — | — | `{ label: 'Guide', tone: 'info' }` | `{ label: 'Hands-on example', tone: 'tip' }` | Page object, with tone `'tip'` |
| `topics` | — | — | — | String array | Page-only `string[]` |

The TypeScript loose-assets page selects root, so it gets root's `'light'` theme instead of the global `'dark'` theme and has no child-only reading time or badge.
Its own `assets` array infers the item kind as `'module' | 'stylesheet'` without a separate page vars interface.

Layout renderer requirements remain deliberately broader than supplied defaults.
Root accepts either `'light'` or `'dark'`, and child accepts badges with either `'info'` or `'tip'` tone, so the page can supply a compatible override without being restricted to the default literal.
The helpers infer the winning source's narrower type rather than intersecting `'light'` and `'dark'` into `never`.
Vars merge shallowly: overriding `badge` must provide the complete required object, not just a new label.

[Compile-time checks](type-checks.ts) exercise the actual example registrations and exports:

- `LayoutProvidedVars<'child'>` includes root defaults plus the awaited child defaults.
- `LayoutRequiredVars<'child'>` identifies `title`, `siteName`, and `locale` as required values not supplied by the layouts.
- `LayoutChainVars` verifies every step of theme precedence, page-only arrays, and global navigation inference.
- Invalid themes, string reading times, incomplete badge overrides, and incompatible page output are rejected.
- `ValidatePageVars` checks actual supplied sources and rejects a missing page title or missing global locale, even though those properties are declared in the renderer contract.

The checks live outside `src` so they are not copied into the built site.
Run them with the example's regular `npm test` command.

#### Checking the exports, not just renderer parameters

The JavaScript and TypeScript source pages now validate their exported vars separately from their renderer signatures.
Each defines a local `pageVars` object and checks it with `ValidatePageVars` when exporting `vars`.
This avoids circular inference while ensuring globals, layout defaults, and the actual page export supply every required renderer property.
`PageForLayout` alone still describes a renderer contract rather than proving that all required values exist.

#### Generated pages with the same registry

[guides.pages.ts](src/guides.pages.ts) uses `PagesForLayout` to generate two child-layout pages:

- `/guides/layout-defaults/` renders async inline content that reads the merged global, root, child, and supplied page vars.
- `/guides/static-content/` supplies static string children checked against the same layout.

The factory receives only global vars, while the inline renderer receives defaults such as `readingMinutes`, `badge`, and `footer`.
Each definition must supply its title and an explicit `layout: 'child'`; it does not need to repeat inherited defaults.
Both factory and inline page declare `Record<string, never>` data contracts, so neither implicitly inherits subscriptions.
Unlike the JavaScript page's light-theme override, these generated pages inherit the child's dark theme.

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
