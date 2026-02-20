---
title: Basic DOMStack Example
md-files: support yaml frontmatter!
---

# Basic DOMStack Example

This example demonstrates a complete basic website built with DOMStack, showcasing the core features without advanced customization.
Please inspect the website, the web inspector (source and network tab), the src code in the example folder as well as the ouput files in the public folder to get an idea of how everything works.

## Features Demonstrated

- Multiple page types (Markdown, HTML, JavaScript)
- Page layouts and nesting
- Asset handling
- Client-side JavaScript
- CSS styling (global and page-specific)
- Frontmatter variables
- Blog with RSS/Atom feeds via `global.data.js` and template files

## Recent Posts

{{{ vars.recentPostsHtml }}}

[View all posts →](./blog/)

## Project Structure

```
src/
├── layouts/              # Layout templates (root, child, blog)
├── blog/                 # Blog posts organized by year
├── md-page/              # Markdown page examples
├── js-page/              # JavaScript page examples
├── html-page/            # HTML page examples
├── feeds.template.js     # JSON Feed + Atom feed generator
├── global.css            # Global styles
├── global.client.ts      # Global client-side JavaScript
├── global.data.js        # Site-wide data (blog post aggregation)
├── global.vars.ts        # Global variables (site name, author, etc.)
└── README.md             # This file (becomes index.html)
```

## Page Examples

Navigate through different page types:

- [Blog](./blog/)
- [Loose Markdown File](./loose-file.md)
- [Markdown Page Example](./md-page/README.md)
- [Nested Markdown Page](./md-page/sub-page/README.md)
- [JavaScript Page Example](./js-page/)
- [HTML Page Example](./html-page/page.html)

## How It Works

- **Markdown Pages**: The title of this document (`h1`) becomes the `title` variable for the page and renders in the `<title>` tag.
- **Layouts**: Pages use layouts defined in the `layouts` directory.
- **Assets**: Static assets are copied to the output directory.
- **Styling**: Both global and page-specific CSS is processed and included.
- **Client JS**: JavaScript bundles are created for enhanced functionality.

## Building the Example

Run the following commands:

```bash
npm install
npm run build
```

To watch for changes during development:

```bash
npm run watch
```
