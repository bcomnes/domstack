# String Layouts Example

This example demonstrates how to create layouts using simple string templates in DOMStack.

## Overview

String layouts provide a straightforward approach to creating HTML templates without requiring a full component library. This example shows how to:

- Create a layout using template literals
- Properly handle variables, scripts, and styles
- Use the recommended structure for DOMStack layouts
- Return plain HTML strings from layout functions

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
├── README.md        # Main content (becomes index.html)
└── root.layout.js   # String-based layout template
```

## How It Works

The `root.layout.js` file demonstrates:

1. Using template literals to create the page structure
2. Rendering head and body sections with string interpolation
3. Properly handling dynamic content, scripts, and styles
4. Supporting string children from markdown and HTML pages

## Key Features

### Simple and Readable

String templates are easy to read and understand, making them a good choice for simpler projects or for developers who prefer working directly with HTML.

### Direct HTML

String layouts keep the output path explicit:
- Return a complete HTML string from the layout function
- Join generated script and stylesheet tags directly
- Insert trusted page HTML into the layout

## Learn More

For more advanced component-based layouts, check out the other examples in the DOMStack repository, particularly:
- basic
- preact-isomorphic

For complete documentation, visit the [DOMStack GitHub repository](https://github.com/bcomnes/domstack).
