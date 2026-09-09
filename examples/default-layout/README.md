# Default Layout Example

This example demonstrates DOMStack's built-in default layout functionality.

## Overview

DOMStack provides a fallback layout system that activates when you don't explicitly define a `root.layout.js` file in your project's `src` directory. This example intentionally omits a custom layout to showcase this feature.

## Key Concepts

When no layout is provided, DOMStack will:
1. Display a warning message during build: `Missing a root.layout.js file. Using default layout file.`
2. Use its internal default layout, which provides a basic HTML structure
3. Properly render your content within this default layout

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
└── README.md  # Main content (becomes index.html)
```

Notice the intentional absence of a `layouts` directory or any layout files.

## Default Layout Features

The default layout provides:
- A basic HTML5 structure
- Proper `<head>` setup with meta tags
- Title handling
- Content insertion
- Minimal styling

## Use Cases

The default layout is useful for:
- Quick prototyping
- Simple content-focused websites
- Getting started with DOMStack without having to create layout files

## Learn More

For information about creating custom layouts, see the other examples in the DOMStack repository, particularly:
- basic
- string-layouts

For complete documentation, visit the [DOMStack GitHub repository](https://github.com/bcomnes/domstack).