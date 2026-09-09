# uhtml-isomorphic Example

This example demonstrates how to use [uhtml-isomorphic](https://github.com/WebReflection/uhtml-isomorphic) with DOMStack for isomorphic component rendering.

## Overview

uhtml-isomorphic is a lightweight library that provides the same API for both server and client rendering, making it easy to build components that work in both environments. This approach offers several benefits:

- Write components once, use them everywhere
- Server-side rendering for fast initial page loads
- Client-side hydration for interactivity
- No JSX compilation required
- Efficient DOM updates

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
├── isomorphic/           # Isomorphic component example
│   ├── client.js         # Client-side hydration code
│   └── page.js           # Server-side rendering code
├── html-mount/           # HTML mount example
│   ├── client.js         # Client mounting code
│   └── page.html         # Static HTML template
├── layouts/              # Layout templates
│   └── root.layout.js    # Root layout using uhtml-isomorphic
└── README.md             # Main content (becomes index.html)
```

## Key Features Demonstrated

### 1. Isomorphic Components

The isomorphic example shows how to:
- Create components that render the same way on server and client
- Share code between environments
- Add client-side interactivity via hydration

### 2. HTML Mounting

The HTML mount example demonstrates:
- Starting with static HTML content
- Using uhtml-isomorphic to enhance it with dynamic client-side features
- Mounting components to specific DOM elements

### 3. uhtml-isomorphic Layout

The root layout shows how to:
- Build a complete HTML document structure
- Insert dynamic content
- Handle scripts and styles

## How uhtml-isomorphic Works

uhtml-isomorphic uses tagged template literals to define components:

```js
import { html, render } from 'uhtml-isomorphic'

// Create a component
const myComponent = (name) => html`
  <div class="greeting">
    <h1>Hello, ${name}!</h1>
    <p>Welcome to uhtml-isomorphic</p>
  </div>
`

// Server-side rendering
const output = render(String, myComponent('World'))

// Client-side rendering
const container = document.querySelector('.app')
render(container, myComponent('World'))
```

## Learn More

- [uhtml-isomorphic Documentation](https://github.com/WebReflection/uhtml-isomorphic)
- [DOMStack Documentation](https://github.com/bcomnes/domstack)

## Related Examples

Check out these other DOMStack examples:
- basic - Core features demonstration
- string-layouts - Simple template string layouts