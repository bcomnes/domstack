# domstack

[![npm version](https://img.shields.io/npm/v/@domstack/static.svg)](https://npmjs.org/package/@domstack/static)
[![npm beta version](https://img.shields.io/npm/v/@domstack/static/beta.svg?label=beta)](https://www.npmjs.com/package/@domstack/static?activeTab=versions)
[![Actions Status](https://github.com/bcomnes/domstack/workflows/tests/badge.svg)](https://github.com/bcomnes/domstack/actions)
[![Coverage Status](https://coveralls.io/repos/github/bcomnes/domstack/badge.svg?branch=master)](https://coveralls.io/github/bcomnes/domstack?branch=master)

DOMStack builds static websites and multi-page apps from [HTML](https://developer.mozilla.org/en-US/docs/Web/HTML), [Markdown](https://commonmark.org/), [CSS](https://developer.mozilla.org/en-US/docs/Web/CSS), and [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript).
No special syntax to learn.
No editor plugins to install.
No complex configuration files to learn.
Just create pages in a directory, and DOMStack builds your site.
It's built around [Node.js](https://nodejs.org/) and [esbuild](https://esbuild.github.io/), with a bunch of features that are there when you need them and stay out of the way when you don't.

[Documentation](docs/) · [Examples](docs/example-projects/) · [v12 migration guide](docs/migrations/v12-migration.md) · [Discord](https://discord.gg/AVTsPRGeR9)

`domstack` supports:

- A natural [filesystem-based router](docs/pages/#page-files)
- Reusable and composable [layouts](docs/layouts/) with fully customizable [templating systems](docs/layouts/#custom-layout-renderers)
- [Markdown pages with frontmatter](docs/pages/#md-pages)
- [HTML pages](docs/pages/#html-pages) (with template support)
- [TS/JS pages](docs/pages/#ts-pages) (pages generated with anything you want)
- A comprehensive [variable cascade system](docs/pages/#variables) (global, layout, and page variables)
- [Static asset management](docs/assets/#static-assets)
- A [live-reloading development server](docs/cli/#usage) (with cross-device sync and debugging tools)
- Fast builds
- Faster [incremental rebuilds](docs/implementation/#watch-mode)
- [esbuild](docs/settings/#esbuildsettingsts)-based [page](docs/pages/#page-client-bundles), [layout](docs/layouts/#layout-client-bundles), and [global client bundling](docs/global-bundles/#global-client-bundles) ([TSX/JSX supported](docs/pages/#tsx))
- [esbuild](docs/settings/#esbuildsettingsts)-based [page](docs/pages/#page-styles), [layout](docs/layouts/#layout-styles), and [global CSS bundling](docs/global-bundles/#global-styles)
- A [global data introspection and collection pipeline](docs/data/)
- Expressive (optional) [TypeScript support](docs/typescript/)
- A comprehensive [build manifest](docs/workers/#domstack-manifest) (for offline MPA support)
- [Service worker support](docs/workers/#service-workers)
- [Web worker support](docs/workers/#web-workers)
- [Page generators](docs/generation/#generated-pages) (generate pages from other pages)
- [Template generators](docs/generation/#templates) (generate anything from pages)
- [Test helpers](docs/api/#test-builds)
- A [default layout and stylesheet](docs/layouts/#the-default-rootlayoutts) if none are provided
- Extensive [examples](docs/example-projects/), [docs](docs/), and a [cookbook](docs/cookbook/)

## Core concepts

`domstack` builds pages from a `src` directory into a destination directory (usually `public`).
Page URLs follow the source directory structure, creating a filesystem router without separate routing configuration.

Given this source:

```text
src/
├── page.md                   # The home page
├── style.css                 # Styles scoped to the home page
├── client.ts                 # Browser code loaded by the home page
├── layouts/
│   ├── root.layout.ts        # The default layout for every page
│   └── blog.layout.ts        # An optional layout selected by page variables
├── globals/
│   ├── global.css            # Styles loaded by every page
│   ├── global.client.ts      # Browser code loaded by every page
│   └── global.vars.ts        # Variables available to every page and layout
├── about/
│   └── page.md               # The /about/ page
├── interactive/
│   ├── page.html             # The /interactive/ page
│   └── client.tsx            # Page-scoped browser UI written with JSX
└── blog/
    ├── page.ts               # The /blog/ page
    └── first-post/
        ├── README.md         # The /blog/first-post/ page
        └── diagram.svg       # A static asset colocated with the post
```

`domstack` produces output resembling the following (generated bundle hashes will vary):

```text
public/
├── index.html                # Home content rendered through root.layout.ts
├── style-ABC123.css          # Bundle built from the home page's style.css
├── client-ABC123.js          # Bundle built from the home page's client.ts
├── globals/
│   ├── global-ABC123.css     # Site-wide bundle built from global.css
│   └── global.client-ABC123.js # Site-wide bundle built from global.client.ts
├── about/
│   └── index.html            # About content rendered through root.layout.ts
├── interactive/
│   ├── index.html            # Loads the bundle built from client.tsx
│   └── client-ABC123.js      # Approximate output name for the TSX bundle
└── blog/
    ├── index.html            # Blog content rendered through the selected layout
    └── first-post/
        ├── index.html        # Post content rendered through the selected layout
        └── diagram.svg       # Copied alongside the page that uses it
```

A page directory contains a `page.md`, `page.html`, or `page.ts` file.
`README.md` may be used instead of `page.md`, making the source tree browsable on GitHub.

Pages can also have colocated assets:

- `style.css` for page-specific styles
- `client.ts` or `client.tsx` for page-specific browser code
- `page.vars.ts` for page variables
- `*.worker.ts` for web workers

> [!NOTE]
> Wherever you see `.ts` being used, you can also use `.js`.
Type checking is supported in both file types.
See [Supported file types](docs/typescript/#supported-file-types) for all available extensions.

Layouts wrap page content in complete HTML documents.
The `root` layout is the default, while pages can select another layout through the `layout` variable.
Global styles, browser code, and variables apply across the site regardless of where their files live in `src`.

Templates and other advanced features can generate additional output as needed.
The [documentation](docs/) covers each convention in detail.

`domstack` ships with sane defaults, so you can point it at a standard [Markdown-documented repository](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github) and build a website with near-zero preparation.

## Installation and first build

Use Node.js 22.18+ within the 22.x release line, or Node.js 24 or newer.
The v12 prerelease is published under the `beta` npm tag.

In a new project directory:

```sh
npm init -y
npm install --save-dev @domstack/static@beta
mkdir src
```

Create `src/page.md`:

```markdown
# Hello, web

This page is built with DOMStack.
```

Build the site:

```sh
npx domstack
```

The generated page is `public/index.html`, rendered with the bundled default layout and stylesheet.
Run `npx domstack --watch` to rebuild on changes, then open the local development server's URL.
Use `npx domstack --serve` to preview a production build.

## Links

- [Documentation](docs/)
- [About](docs/about/)
- [Examples](docs/example-projects/)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Dependency graph](dependencygraph.svg)
- [fragtml documentation](https://github.com/bcomnes/fragtml#readme)
- [Historical v11 migration guide](docs/migrations/v11-migration.md)

## License

[MIT](LICENSE)
