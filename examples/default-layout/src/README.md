---
title: Default Layout Example
---

# Default Layout Example

## Overview

DOMStack ships with a built-in default layout that automatically activates when you don't include a `root.layout.js` file in your project's `src` directory. This example intentionally omits any custom layout files to demonstrate this fallback functionality.

## How It Works

When no custom layout is provided:

1. DOMStack detects the absence of a `root.layout.js` file
2. The build process shows a warning: `Missing a root layout file. Using default layout file.`
3. The system automatically applies the built-in default layout
4. Your content is properly rendered within this default HTML structure

## Default Layout Features

The built-in default layout includes:

- Standard HTML5 doctype and structure
- Proper metadata tags including charset and viewport settings
- Automatic title handling (using your page's H1 content)
- Responsive design considerations
- Script and stylesheet injection points
- Semantic HTML structure for content

## Generated HTML Structure

When using the default layout, your content will be wrapped in HTML similar to this:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Your Page Title | Your Site Name</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <!-- Automatically injected stylesheets -->
    <!-- Automatically injected scripts -->
  </head>
  <body>
    <main>
      <!-- Your page content appears here -->
    </main>
  </body>
</html>
```

## Benefits

The default layout provides several advantages:

- Quick start without needing to create layout files
- Basic but functional HTML5 structure with proper metadata
- Automatic title handling from your content's H1
- Clean and simple presentation for content-focused projects
- Reduces boilerplate code in small projects

## Try It Yourself

To see the default layout in action:

1. Examine the project structure - notice there's no layout file
2. Build the project and observe the warning message:
   ```
   Missing a root layout file. Using default layout file.
   ```
3. View the generated HTML output in the `public` directory to see how the default layout wraps the content

## When to Use Custom Layouts

While the default layout is convenient for getting started, you should create custom layouts when you need:

- Custom navigation elements
- Site-specific branding and design
- Advanced layout structures
- Special metadata or analytics integrations

For custom layouts, check the other examples in the DOMStack repository, particularly the `basic` example.

## Ejecting from the Default Layout

If you want to customize the default layout, you can use the `--eject` flag to extract the built-in layout into your project:

```bash
npx domstack --eject
```

This command will:

1. Create a `root.layout.js` file in your project's `src` directory
2. Copy the contents of the default layout into this new file
3. Allow you to modify the layout to suit your specific needs

After ejecting, you can edit the generated `root.layout.js` file like any other custom layout. This gives you a solid foundation to build upon rather than starting from scratch.

> **Note:** Once you eject, DOMStack will use your custom layout file instead of the built-in default. If you want to revert to the original default layout, you'll need to delete your custom `root.layout.js` file.
