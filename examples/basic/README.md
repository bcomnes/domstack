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

- Node.js 22.x or higher

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
