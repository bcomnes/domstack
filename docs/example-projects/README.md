---
layout: docs
handlebars: false
---

# Example projects

## Table of Contents

[[toc]]

## Examples

A collection of examples can be found in the [`./examples`](https://github.com/bcomnes/domstack/tree/master/examples) folder:

- [`basic`](https://github.com/bcomnes/domstack/tree/master/examples/basic) — A broad tour of Markdown, HTML, and TypeScript pages, nested pages and layouts, variables, styles, client bundles, and static assets.
- [`blog`](https://github.com/bcomnes/domstack/tree/master/examples/blog) — A blog with derived global data, generated archive pages, redirects, nested layouts, and feed templates.
- [`css-modules`](https://github.com/bcomnes/domstack/tree/master/examples/css-modules) — Using CSS Modules from page code alongside global and page styles.
- [`default-layout`](https://github.com/bcomnes/domstack/tree/master/examples/default-layout) — Building a Markdown site with DOMStack's built-in default layout and no custom layout.
- [`esbuild-settings`](https://github.com/bcomnes/domstack/tree/master/examples/esbuild-settings) — Customizing the browser build through `esbuild.settings`.
- [`markdown-settings`](https://github.com/bcomnes/domstack/tree/master/examples/markdown-settings) — Customizing Markdown rendering with `markdown-it.settings` and Markdown-it plugins.
- [`nested-dest`](https://github.com/bcomnes/domstack/tree/master/examples/nested-dest) — Using the project root as `src` while writing the built site to a nested `public` directory.
- [`preact-isomorphic`](https://github.com/bcomnes/domstack/tree/master/examples/preact-isomorphic) — Rendering with Preact on the server and mounting page-scoped Preact and JSX in the browser.
- [`react`](https://github.com/bcomnes/domstack/tree/master/examples/react) — Configuring React and TypeScript for a page-scoped TSX client.
- [`static-mpa-offline`](https://github.com/bcomnes/domstack/tree/master/examples/static-mpa-offline) — A static multi-page app with DOMStack manifests, an offline fallback, precaching, and custom service-worker caching policies.
- [`static-mpa-workbox-offline`](https://github.com/bcomnes/domstack/tree/master/examples/static-mpa-workbox-offline) — The offline static MPA pattern implemented with Workbox routing, strategies, and precaching.
- [`string-layouts`](https://github.com/bcomnes/domstack/tree/master/examples/string-layouts) — Writing layouts that return plain HTML strings instead of using the default renderer.
- [`tailwind`](https://github.com/bcomnes/domstack/tree/master/examples/tailwind) — Integrating Tailwind CSS through an esbuild plugin.
- [`type-stripping`](https://github.com/bcomnes/domstack/tree/master/examples/type-stripping) — Using Node.js type stripping for TypeScript pages and layouts, plus a page-scoped TSX client.
- [`uhtml-isomorphic`](https://github.com/bcomnes/domstack/tree/master/examples/uhtml-isomorphic) — Rendering with `uhtml-isomorphic` on the server and mounting or hydrating UI in the browser.
- [`worker-example`](https://github.com/bcomnes/domstack/tree/master/examples/worker-example) — Bundling and communicating with page-scoped JavaScript and TypeScript Web Workers.

To run an example:

```bash
$ git clone git@github.com:bcomnes/domstack.git
$ cd domstack
# install the root package and all example workspaces
$ npm i
# build one example workspace
$ npm --workspace @domstack/basic-example run build
```

### External examples

Here are some additional external examples of larger domstack projects.
If you have a project that uses domstack and could act as a nice example, please PR it to the list!

- [Blog Example](https://github.com/bcomnes/bret.io/) - A personal blog written with DOMStack
- [Isomorphic Static/Client App](https://github.com/hifiwi-fi/breadcrum.net/tree/master/packages/web/client) - Pages build from client templates and hydrate on load.
- [Zero-Conf Markdown Docs](https://github.com/bcomnes/deploy-to-neocities/blob/70b264bcb37fca5b21e45d6cba9265f97f6bfa6f/package.json#L38) - A npm package with markdown docs, transformed into a website without any any configuration

(Did you make a cool DOMStack website that is open source?
PR it to the list!)

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
