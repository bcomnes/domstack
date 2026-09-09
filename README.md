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

Use Node.js 22 or Node.js 24 or newer.
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

<details>
<summary>Moved reference sections (existing bookmarks)</summary>

The detailed reference now lives in the documentation above.
Existing documentation-site bookmarks open their new locations automatically.
On GitHub, follow the corresponding link below.

<a id="table-of-contents" data-reference-url="docs/" href="docs/">table-of-contents</a>

<a id="usage" data-reference-url="docs/cli/#usage" href="docs/cli/#usage">usage</a>

<a id="examples" data-reference-url="docs/example-projects/#examples" href="docs/example-projects/#examples">examples</a>

<a id="external-examples" data-reference-url="docs/example-projects/#external-examples" href="docs/example-projects/#external-examples">external-examples</a>

<a id="ejecting-the-defaults" data-reference-url="docs/cli/#ejecting-the-defaults" href="docs/cli/#ejecting-the-defaults">ejecting-the-defaults</a>

<a id="pages" data-reference-url="docs/pages/#pages" href="docs/pages/#pages">pages</a>

<a id="md-pages" data-reference-url="docs/pages/#md-pages" href="docs/pages/#md-pages">md-pages</a>

<a id="html-pages" data-reference-url="docs/pages/#html-pages" href="docs/pages/#html-pages">html-pages</a>

<a id="ts-pages" data-reference-url="docs/pages/#ts-pages" href="docs/pages/#ts-pages">ts-pages</a>

<a id="page-styles" data-reference-url="docs/pages/#page-styles" href="docs/pages/#page-styles">page-styles</a>

<a id="page-client-bundles" data-reference-url="docs/pages/#page-client-bundles" href="docs/pages/#page-client-bundles">page-client-bundles</a>

<a id=".tsx" data-reference-url="docs/pages/#tsx" href="docs/pages/#tsx">.tsx</a>

<a id="tsx" data-reference-url="docs/pages/#tsx" href="docs/pages/#tsx">tsx</a>

<a id="page-variable-files" data-reference-url="docs/pages/#page-variable-files" href="docs/pages/#page-variable-files">page-variable-files</a>

<a id="draft-pages" data-reference-url="docs/pages/#draft-pages" href="docs/pages/#draft-pages">draft-pages</a>

<a id="layouts" data-reference-url="docs/layouts/" href="docs/layouts/">layouts</a>

<a id="layout-module-exports" data-reference-url="docs/layouts/#layout-module-exports" href="docs/layouts/#layout-module-exports">layout-module-exports</a>

<a id="declaring-nested-layouts" data-reference-url="docs/layouts/#declaring-nested-layouts" href="docs/layouts/#declaring-nested-layouts">declaring-nested-layouts</a>

<a id="layout-variables" data-reference-url="docs/layouts/#layout-variables" href="docs/layouts/#layout-variables">layout-variables</a>

<a id="layout-render-function" data-reference-url="docs/layouts/#layout-render-function" href="docs/layouts/#layout-render-function">layout-render-function</a>

<a id="the-default-root.layout.ts" data-reference-url="docs/layouts/#the-default-rootlayoutts" href="docs/layouts/#the-default-rootlayoutts">the-default-root.layout.ts</a>

<a id="the-default-rootlayoutts" data-reference-url="docs/layouts/#the-default-rootlayoutts" href="docs/layouts/#the-default-rootlayoutts">the-default-rootlayoutts</a>

<a id="layout-styles" data-reference-url="docs/layouts/#layout-styles" href="docs/layouts/#layout-styles">layout-styles</a>

<a id="layout-client-bundles" data-reference-url="docs/layouts/#layout-client-bundles" href="docs/layouts/#layout-client-bundles">layout-client-bundles</a>

<a id="layout-types" data-reference-url="docs/layouts/#layout-types" href="docs/layouts/#layout-types">layout-types</a>

<a id="variables" data-reference-url="docs/pages/#variables" href="docs/pages/#variables">variables</a>

<a id="variable-providers" data-reference-url="docs/pages/#variable-providers" href="docs/pages/#variable-providers">variable-providers</a>

<a id="static-assets" data-reference-url="docs/assets/#static-assets" href="docs/assets/#static-assets">static-assets</a>

<a id="--copy-directories" data-reference-url="docs/assets/#--copy-directories" href="docs/assets/#--copy-directories">--copy-directories</a>

<a id="global-assets" data-reference-url="docs/assets/#global-assets" href="docs/assets/#global-assets">global-assets</a>

<a id="global.vars.ts" data-reference-url="docs/settings/#globalvarsts" href="docs/settings/#globalvarsts">global.vars.ts</a>

<a id="globalvarsts" data-reference-url="docs/settings/#globalvarsts" href="docs/settings/#globalvarsts">globalvarsts</a>

<a id="browser-variable" data-reference-url="docs/settings/#browser-variable" href="docs/settings/#browser-variable">browser-variable</a>

<a id="global.client.ts" data-reference-url="docs/assets/#globalclientts" href="docs/assets/#globalclientts">global.client.ts</a>

<a id="globalclientts" data-reference-url="docs/assets/#globalclientts" href="docs/assets/#globalclientts">globalclientts</a>

<a id="global.css" data-reference-url="docs/assets/#globalcss" href="docs/assets/#globalcss">global.css</a>

<a id="globalcss" data-reference-url="docs/assets/#globalcss" href="docs/assets/#globalcss">globalcss</a>

<a id="optional-cascade-layers" data-reference-url="docs/assets/#optional-cascade-layers" href="docs/assets/#optional-cascade-layers">optional-cascade-layers</a>

<a id="esbuild.settings.ts" data-reference-url="docs/settings/#esbuildsettingsts" href="docs/settings/#esbuildsettingsts">esbuild.settings.ts</a>

<a id="esbuildsettingsts" data-reference-url="docs/settings/#esbuildsettingsts" href="docs/settings/#esbuildsettingsts">esbuildsettingsts</a>

<a id="default-build-behavior" data-reference-url="docs/settings/#default-build-behavior" href="docs/settings/#default-build-behavior">default-build-behavior</a>

<a id="markdown-it.settings.ts" data-reference-url="docs/settings/#markdown-itsettingsts" href="docs/settings/#markdown-itsettingsts">markdown-it.settings.ts</a>

<a id="markdown-itsettingsts" data-reference-url="docs/settings/#markdown-itsettingsts" href="docs/settings/#markdown-itsettingsts">markdown-itsettingsts</a>

<a id="global-data" data-reference-url="docs/data/#global-data" href="docs/data/#global-data">global-data</a>

<a id="global-data-types" data-reference-url="docs/data/#global-data-types" href="docs/data/#global-data-types">global-data-types</a>

<a id="global-data-caveats" data-reference-url="docs/data/#global-data-caveats" href="docs/data/#global-data-caveats">global-data-caveats</a>

<a id="generated-pages" data-reference-url="docs/generation/#generated-pages" href="docs/generation/#generated-pages">generated-pages</a>

<a id="generated-pages-exports" data-reference-url="docs/generation/#generated-pages-exports" href="docs/generation/#generated-pages-exports">generated-pages-exports</a>

<a id="one-page-definition" data-reference-url="docs/generation/#one-page-definition" href="docs/generation/#one-page-definition">one-page-definition</a>

<a id="page-definition-array" data-reference-url="docs/generation/#page-definition-array" href="docs/generation/#page-definition-array">page-definition-array</a>

<a id="synchronous-factory" data-reference-url="docs/generation/#synchronous-factory" href="docs/generation/#synchronous-factory">synchronous-factory</a>

<a id="asynchronous-factory" data-reference-url="docs/generation/#asynchronous-factory" href="docs/generation/#asynchronous-factory">asynchronous-factory</a>

<a id="async-iterable" data-reference-url="docs/generation/#async-iterable" href="docs/generation/#async-iterable">async-iterable</a>

<a id="generated-pages-factory-parameters" data-reference-url="docs/generation/#generated-pages-factory-parameters" href="docs/generation/#generated-pages-factory-parameters">generated-pages-factory-parameters</a>

<a id="generated-page-definitions" data-reference-url="docs/generation/#generated-page-definitions" href="docs/generation/#generated-page-definitions">generated-page-definitions</a>

<a id="generated-pages-types" data-reference-url="docs/generation/#generated-pages-types" href="docs/generation/#generated-pages-types">generated-pages-types</a>

<a id="templates" data-reference-url="docs/generation/#templates" href="docs/generation/#templates">templates</a>

<a id="simple-string-template" data-reference-url="docs/generation/#simple-string-template" href="docs/generation/#simple-string-template">simple-string-template</a>

<a id="object-template" data-reference-url="docs/generation/#object-template" href="docs/generation/#object-template">object-template</a>

<a id="object-array-template" data-reference-url="docs/generation/#object-array-template" href="docs/generation/#object-array-template">object-array-template</a>

<a id="asynciterator-template" data-reference-url="docs/generation/#asynciterator-template" href="docs/generation/#asynciterator-template">asynciterator-template</a>

<a id="choosing-a-template-return-type" data-reference-url="docs/generation/#choosing-a-template-return-type" href="docs/generation/#choosing-a-template-return-type">choosing-a-template-return-type</a>

<a id="page-data-and-introspection" data-reference-url="docs/data/#page-data-and-introspection" href="docs/data/#page-data-and-introspection">page-data-and-introspection</a>

<a id="page-metadata" data-reference-url="docs/data/#page-metadata" href="docs/data/#page-metadata">page-metadata</a>

<a id="rendering-page-content" data-reference-url="docs/data/#rendering-page-content" href="docs/data/#rendering-page-content">rendering-page-content</a>

<a id="rendering-many-pages" data-reference-url="docs/data/#rendering-many-pages" href="docs/data/#rendering-many-pages">rendering-many-pages</a>

<a id="typescript-support" data-reference-url="docs/typescript/#typescript-support" href="docs/typescript/#typescript-support">typescript-support</a>

<a id="supported-file-types" data-reference-url="docs/typescript/#supported-file-types" href="docs/typescript/#supported-file-types">supported-file-types</a>

<a id="recommended-tsconfig.json" data-reference-url="docs/typescript/#recommended-tsconfigjson" href="docs/typescript/#recommended-tsconfigjson">recommended-tsconfig.json</a>

<a id="recommended-tsconfigjson" data-reference-url="docs/typescript/#recommended-tsconfigjson" href="docs/typescript/#recommended-tsconfigjson">recommended-tsconfigjson</a>

<a id="using-typescript-with-domstack-types" data-reference-url="docs/typescript/#using-typescript-with-domstack-types" href="docs/typescript/#using-typescript-with-domstack-types">using-typescript-with-domstack-types</a>

<a id="advanced-type-parameters" data-reference-url="docs/typescript/#advanced-type-parameters" href="docs/typescript/#advanced-type-parameters">advanced-type-parameters</a>

<a id="advanced" data-reference-url="docs/layouts/#custom-layout-renderers" href="docs/layouts/#custom-layout-renderers">advanced</a>

<a id="custom-layout-renderers" data-reference-url="docs/layouts/#custom-layout-renderers" href="docs/layouts/#custom-layout-renderers">custom-layout-renderers</a>

<a id="web-workers" data-reference-url="docs/workers/#web-workers" href="docs/workers/#web-workers">web-workers</a>

<a id="service-workers" data-reference-url="docs/workers/#service-workers" href="docs/workers/#service-workers">service-workers</a>

<a id="registration-and-web-app-manifests" data-reference-url="docs/workers/#registration-and-web-app-manifests" href="docs/workers/#registration-and-web-app-manifests">registration-and-web-app-manifests</a>

<a id="domstack-manifest" data-reference-url="docs/workers/#domstack-manifest" href="docs/workers/#domstack-manifest">domstack-manifest</a>

<a id="enable-the-manifest" data-reference-url="docs/workers/#enable-the-manifest" href="docs/workers/#enable-the-manifest">enable-the-manifest</a>

<a id="configure-entries-and-policy" data-reference-url="docs/workers/#configure-entries-and-policy" href="docs/workers/#configure-entries-and-policy">configure-entries-and-policy</a>

<a id="manifest-built-hooks" data-reference-url="docs/workers/#manifest-built-hooks" href="docs/workers/#manifest-built-hooks">manifest-built-hooks</a>

<a id="service-worker-integration" data-reference-url="docs/workers/#service-worker-integration" href="docs/workers/#service-worker-integration">service-worker-integration</a>

<a id="programmatic-configuration" data-reference-url="docs/workers/#programmatic-configuration" href="docs/workers/#programmatic-configuration">programmatic-configuration</a>

<a id="programmatic-test-builds" data-reference-url="docs/api/#programmatic-test-builds" href="docs/api/#programmatic-test-builds">programmatic-test-builds</a>

<a id="cookbook" data-reference-url="docs/cookbook/#cookbook" href="docs/cookbook/#cookbook">cookbook</a>

<a id="compose-nested-layouts" data-reference-url="docs/cookbook/#compose-nested-layouts" href="docs/cookbook/#compose-nested-layouts">compose-nested-layouts</a>

<a id="layout-composition-pitfalls" data-reference-url="docs/cookbook/#manual-composition" href="docs/cookbook/#manual-composition">layout-composition-pitfalls</a>

<a id="data-subscriptions-in-nested-layouts" data-reference-url="docs/cookbook/#data-subscriptions-in-nested-layouts" href="docs/cookbook/#data-subscriptions-in-nested-layouts">data-subscriptions-in-nested-layouts</a>

<a id="manual-composition" data-reference-url="docs/cookbook/#manual-composition" href="docs/cookbook/#manual-composition">manual-composition</a>

<a id="nested-layout-client-bundles-and-styles" data-reference-url="docs/cookbook/#nested-layout-client-bundles-and-styles" href="docs/cookbook/#nested-layout-client-bundles-and-styles">nested-layout-client-bundles-and-styles</a>

<a id="generate-rss-and-json-feeds" data-reference-url="docs/cookbook/#generate-rss-and-json-feeds" href="docs/cookbook/#generate-rss-and-json-feeds">generate-rss-and-json-feeds</a>

<a id="generate-yearly-blog-index-pages" data-reference-url="docs/cookbook/#generate-yearly-blog-index-pages" href="docs/cookbook/#generate-yearly-blog-index-pages">generate-yearly-blog-index-pages</a>

<a id="generate-redirect-pages-from-page-metadata" data-reference-url="docs/cookbook/#generate-redirect-pages-from-page-metadata" href="docs/cookbook/#generate-redirect-pages-from-page-metadata">generate-redirect-pages-from-page-metadata</a>

<a id="implementation" data-reference-url="docs/implementation/#implementation" href="docs/implementation/#implementation">implementation</a>

<a id="build-process-flow" data-reference-url="docs/implementation/#build-process-flow" href="docs/implementation/#build-process-flow">build-process-flow</a>

<a id="buildpages()-detail" data-reference-url="docs/implementation/#buildpages-detail" href="docs/implementation/#buildpages-detail">buildpages()-detail</a>

<a id="buildpages-detail" data-reference-url="docs/implementation/#buildpages-detail" href="docs/implementation/#buildpages-detail">buildpages-detail</a>

<a id="watch-mode" data-reference-url="docs/implementation/#watch-mode" href="docs/implementation/#watch-mode">watch-mode</a>

<a id="what-triggers-what" data-reference-url="docs/implementation/#what-triggers-what" href="docs/implementation/#what-triggers-what">what-triggers-what</a>

<a id="dependency-tracking" data-reference-url="docs/implementation/#dependency-tracking" href="docs/implementation/#dependency-tracking">dependency-tracking</a>

<a id="stable-entry-filenames" data-reference-url="docs/implementation/#stable-entry-filenames" href="docs/implementation/#stable-entry-filenames">stable-entry-filenames</a>

<a id="manifest-behavior" data-reference-url="docs/implementation/#manifest-behavior" href="docs/implementation/#manifest-behavior">manifest-behavior</a>

<a id="build-serialization" data-reference-url="docs/implementation/#build-serialization" href="docs/implementation/#build-serialization">build-serialization</a>

<a id="design-goals" data-reference-url="docs/about/#design-goals" href="docs/about/#design-goals">design-goals</a>

<a id="be-simple-and-dependable" data-reference-url="docs/about/#be-simple-and-dependable" href="docs/about/#be-simple-and-dependable">be-simple-and-dependable</a>

<a id="build-on-the-web-platform" data-reference-url="docs/about/#build-on-the-web-platform" href="docs/about/#build-on-the-web-platform">build-on-the-web-platform</a>

<a id="make-structure-visible" data-reference-url="docs/about/#make-structure-visible" href="docs/about/#make-structure-visible">make-structure-visible</a>

<a id="keep-build-steps-orthogonal" data-reference-url="docs/about/#keep-build-steps-orthogonal" href="docs/about/#keep-build-steps-orthogonal">keep-build-steps-orthogonal</a>

<a id="use-standard-language-tooling" data-reference-url="docs/about/#use-standard-language-tooling" href="docs/about/#use-standard-language-tooling">use-standard-language-tooling</a>

<a id="prefer-durable-choices" data-reference-url="docs/about/#prefer-durable-choices" href="docs/about/#prefer-durable-choices">prefer-durable-choices</a>

<a id="faq" data-reference-url="docs/about/#faq" href="docs/about/#faq">faq</a>

<a id="project-status" data-reference-url="docs/about/#project-status" href="docs/about/#project-status">project-status</a>

</details>
