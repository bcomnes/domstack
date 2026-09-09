# domstack

[![npm version](https://img.shields.io/npm/v/@domstack/static.svg)](https://npmjs.org/package/@domstack/static)
[![npm beta version](https://img.shields.io/npm/v/@domstack/static/beta.svg?label=beta)](https://www.npmjs.com/package/@domstack/static?activeTab=versions)
[![Actions Status](https://github.com/bcomnes/domstack/workflows/tests/badge.svg)](https://github.com/bcomnes/domstack/actions)
[![Coverage Status](https://coveralls.io/repos/github/bcomnes/domstack/badge.svg?branch=master)](https://coveralls.io/github/bcomnes/domstack?branch=master)

DOMStack builds static websites and multi-page apps from HTML, Markdown, CSS, and JavaScript.
A few file conventions connect Node.js and esbuild: directories define URLs, layouts wrap pages, and colocated styles and client code become browser bundles.
Use the rendering libraries you like, including TypeScript and JSX where supported.

[Documentation](docs/) · [Examples](docs/example-projects/) · [v12 migration guide](docs/v12-migration.md) · [Discord](https://discord.gg/AVTsPRGeR9)

## Getting started

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
Run `npx domstack --watch` to rebuild on changes and open the local development server's URL.
Use `npx domstack --serve` to preview a production build.

## Core Concepts

`domstack` builds pages from a `src` directory into a destination directory, usually `public`.
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
The following sections document each convention in detail.

`domstack` ships with sane defaults, so you can point it at a standard [markdown-documented repository](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github) and build a website with near-zero preparation.

## Documentation

- [Pages](docs/pages/)
- [Layouts](docs/layouts/)
- [Assets](docs/assets/)
- [Settings](docs/settings/)
- [Data](docs/data/)
- [Generation](docs/generation/)
- [TypeScript](docs/typescript/)
- [Workers](docs/workers/)
- [Recipes](docs/cookbook/)
- [CLI](docs/cli/)
- [API](docs/api/)
- [Implementation](docs/implementation/)
- [About](docs/about/)

## Links

- [Examples](docs/example-projects/)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Dependency graph](dependencygraph.svg)
- [fragtml documentation](https://github.com/bcomnes/fragtml#readme)
- [Historical v11 migration guide](docs/v11-migration.md)

## License

[MIT](LICENSE)
