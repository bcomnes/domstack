# Migration Guide: domstack v12

This guide covers breaking and notable changes when moving from domstack v11 to v12.

If you are migrating from `top-bun`, first follow the historical v11 guide at [v11-migration.md](v11-migration.md).
Then apply the v12 changes below.

## Table of Contents

[[toc]]

---

## Runtime requirements

DOMStack v12 supports Node.js 22 and Node.js 24 or newer:

```json
{
  "engines": {
    "node": "^22.0.0 || >=24.0.0"
  }
}
```

Node.js 23 satisfied v11's `>=22` engine range but is not supported by v12. Move development, CI, and deployment environments to Node.js 22 LTS or Node.js 24+ before upgrading.

---

## Public type imports use `@domstack/static/types.js`

Runtime values remain available from `@domstack/static`. Public type-only imports must use the dedicated `@domstack/static/types.js` entry. The root package still includes declarations for its runtime API.

```ts
// Before v12
import type { LayoutFunction, PageFunction, DomStackOpts } from '@domstack/static'

// v12+
import type { LayoutFunction, PageFunction, DomStackOpts } from '@domstack/static/types.js'
```

---

## Development server uses `@domstack/sync`

Watch/serve mode now uses [`@domstack/sync`](https://www.npmjs.com/package/@domstack/sync) for the local development server.

This provides live reload, CSS injection, ghost mode, and the UI panel.
If you were relying on BrowserSync-specific behavior or output, update your expectations around logs, access URLs, and reload handling.

v12 also adds `--serve` for a production-like, one-shot preview. It builds once and serves the destination without watch-mode filenames or live-reload injection:

```sh
domstack --serve --port 4000
```

`--port` is valid only with `--serve`. Do not combine `--serve` with `--watch` or `--watch-only`. Use `--watch` for development and `--serve` for final output, service-worker, and cache-lifecycle testing.

---

## Default layout uses fragtml

The bundled default `root.layout.js` now uses [`fragtml`](https://github.com/bcomnes/fragtml#readme) for server-side HTML rendering.

If you rely on the bundled default layout, make sure your pages and child layouts return compatible values.
The v12 default layout accepts HTML strings and `fragtml` template results.
It does not render Preact or HTM VNodes.

If you already ejected or provide your own root layout, you do not have to change that layout for v12.
Keep the dependencies that your layout imports in your own `package.json`.

If you want to update to v12 while keeping the v11 Preact default layout, run `domstack --eject` on v11 before upgrading.
Then keep `htm`, `preact`, and `preact-render-to-string` installed after the upgrade.

If you want to migrate an ejected Preact/HTM layout to the v12 default style, update your layout imports and rendering code from Preact/HTM to `fragtml`.

```ts
// Before: src/root.layout.ts
import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'
```

```ts
// After: src/root.layout.ts
import { html, raw, render } from 'fragtml'
```

Use `raw(htmlString)` when intentionally inserting already-rendered HTML.
Markdown output passed to a layout as `children` is one example.

---

## Layout modules can export vars

Layouts can now export optional `vars` that are merged into the resolved variable cascade for every source-backed or generated page using that layout. Like page and global vars, layout vars may be an object, a sync function, or an async function.

This primarily supports generated pages. A generated page can select a layout but does not have an adjacent page directory or `page.vars.ts` file from which to inherit layout-specific defaults. Exporting those defaults from the layout lets source-backed and generated pages receive the same values without repeating them in every generated-page definition.

```ts
// src/layouts/article.layout.ts
export const vars = {
  showSidebar: true,
  pageType: 'article',
}
```

Precedence is:

```txt
page/frontmatter vars > page.vars.* > layout vars > global.data/global.vars > domstack defaults
```

Layout vars also let shared defaults, including manifest and service-worker policy values, participate in the normal variable cascade instead of being mixed into rendered output by each layout. If an existing layout manually merges defaults into the values it passes to a child layout or template, move those defaults to the layout's exported `vars` so generated-page definitions, page vars, and frontmatter can override them consistently.

This is additive for most sites. If a layout module already exported a named `vars` value for another purpose, that value will now participate in page variable resolution. Rename that export if it was not intended as layout defaults.

---

## Declare nested layouts with parentLayout

Layouts can now export a static `parentLayout` name instead of importing and invoking their parent render function.
Pages still select the innermost layout through `vars.layout`.

```ts
// article.layout.ts
export const parentLayout = 'root'
export const vars = { showSidebar: true }

export default function articleLayout ({ children }) {
  return `<article>${children}</article>`
}
```

DOMStack renders from the page outward and passes intermediate values unchanged between layouts.
All renderers receive the final resolved vars, with precedence:

```text
builder/frontmatter > page.vars.* > inner layout vars > outer layout vars > global vars > defaults
```

Styles and client entry points are included automatically in default, global, outer-layout, inner-layout, page order.
Watch mode follows the resolved chain and each layout's ordinary imported helpers for both source-backed and generated pages.
Missing parents, invalid parent names, and cycles fail the build.

Existing single layouts and manual function composition continue to work.
Manual composition is tested for rendering, forwarded assets, and watch rebuilds through statically imported parent functions.
Prefer `parentLayout` for normal nesting so DOMStack manages the full layout dependency chain and its assets automatically.
To migrate a manually nested layout, replace its parent call with `parentLayout`, return only its own wrapper, and remove explicit imports of the parent's layout CSS and client.
Move manually merged defaults to the appropriate layout's `vars` export.
Do not retain both the parent function call and `parentLayout`, because that renders the parent twice.
Manual composition remains responsible for its own vars, asset imports, and argument forwarding.

## Keep layout dependencies explicit

DOMStack only installs dependencies for its bundled defaults.
Your project is responsible for any packages imported by pages, layouts, globals, or browser clients.

If your ejected layout or server-side pages import `htm/preact`, `preact`, or `preact-render-to-string`, keep those packages in your own `package.json`.
If you migrate those server-side templates to `fragtml`, replace those dependencies with `fragtml`.

---

## JSX runtime is opt-in

Client `.jsx` and `.tsx` bundles are still supported through esbuild.
DOMStack no longer configures Preact as the default JSX runtime.

If your browser client code uses JSX or TSX, install the runtime you want and configure it with `esbuild.settings`.

For Preact:

```sh
npm install preact
```

```ts
// src/esbuild.settings.ts
import type { BuildOptions } from '@domstack/static/types.js'

export default function esbuildSettingsOverride (settings: BuildOptions): BuildOptions {
  return {
    ...settings,
    jsx: 'automatic',
    jsxImportSource: 'preact',
  }
}
```

For React:

```sh
npm install react react-dom
```

```ts
// src/esbuild.settings.ts
import type { BuildOptions } from '@domstack/static/types.js'

export default function esbuildSettingsOverride (settings: BuildOptions): BuildOptions {
  return {
    ...settings,
    jsx: 'automatic',
    jsxImportSource: 'react',
  }
}
```

---

## mine.css v11 and optional CSS layers

DOMStack v12 updates its bundled default stylesheet from mine.css v10 to v11.
Sites that use the bundled default layout and stylesheet receive the update without changing their source.
The migration steps below apply only when a project imports mine.css directly, has ejected DOMStack's defaults, or has customized behavior removed by mine.css v11.
Review the complete [mine.css v11 migration guide](https://github.com/bcomnes/mine.css/blob/master/MIGRATION.md) in those cases.

mine.css v11 is CSS-only.
Its package root now resolves to the main stylesheet, and its JavaScript theme switcher is no longer published.
Direct consumers should replace the old deep import with the package root:

```css
@import 'mine.css';
```

Direct or ejected consumers should remove JavaScript imports of `mine.css` or `mine.css/dist/theme-switcher.js`, calls to `toggleTheme()`, stored theme state, theme controls, and `.light-mode` or `.dark-mode` rules.
Custom root layouts that use mine.css should include `<meta name="color-scheme" content="light dark">` and use `prefers-color-scheme` for application-specific dark styles.
If an ejected stylesheet uses Highlight.js, load a light theme normally and a dark theme conditionally instead of applying one dark theme in both modes.

The optional mine.css layout remains a separate import.
DOMStack's default stylesheet imports it explicitly, and ejected sites that want the same layout should continue to do so.

### Optional cascade-layer pattern

The main mine.css stylesheet places its framework rules in the low-priority `mine` layer.
DOMStack's default stylesheet imports mine.css normally and places its optional layout and Highlight.js sidecars in `domstack.default`:

```css
@import 'mine.css';
@import 'mine.css/dist/layout.css' layer(domstack.default);
@import 'highlight.js/styles/github.css' layer(domstack.default);
@import 'highlight.js/styles/github-dark-dimmed.css' layer(domstack.default) (prefers-color-scheme: dark);
```

Custom stylesheets do not have to use layers.
Unlayered author rules override normal declarations in `mine` and `domstack.default`.

Projects that want explicit layers can let each DOMStack stylesheet declare only its own scope:

```css
/* global.css */
@layer domstack.global {
  /* Site-wide rules */
}
```

```css
/* article.layout.css */
@layer domstack.layout {
  /* Layout rules */
}
```

```css
/* style.css */
@layer domstack.page {
  /* Page rules */
}
```

No stylesheet needs to enumerate the other scopes.
DOMStack loads default, global, layout, and page styles in that order, so the layers are first encountered with the corresponding low-to-high precedence.
This is a recommended organizational pattern, not a migration requirement.

mine.css v11 intentionally changes typography, forms, tables, media framing, motion, focus treatment, and the optional `.mine-layout` width.
Direct, ejected, or heavily customized consumers should review those surfaces against the upstream migration guide.
The distributed CSS uses native CSS nesting, and mine.css requires Node.js 22 or newer and npm 10 or newer for installation.

---

## CLI `--target` moved to `esbuild.settings.*`

The `domstack --target` / `domstack -t` CLI flag has been removed in v12. Configure esbuild targets in
`esbuild.settings.*` instead.

```ts
// src/esbuild.settings.ts
import type { BuildOptions } from '@domstack/static/types.js'

export default function esbuildSettings (settings: BuildOptions): BuildOptions {
  return {
    ...settings,
    target: ['es2022', 'chrome120', 'firefox121', 'safari17'],
  }
}
```

DOMStack does not set a rolling “modern browser” target by default. If your project needs specific
syntax lowering, set explicit esbuild targets in this settings file. See
[esbuild's target docs](https://esbuild.github.io/api/#target) for accepted values.

---

## Default esbuild asset loaders

v12 adds default loaders for assets imported by browser bundles. This is a breaking change for projects that import these file types or replace `esbuildSettings.loader`.

| Loader | Extensions | v12 behavior |
|---|---|---|
| `dataurl` | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.avif` | Embed the imported asset in its bundle |
| `file` | `.ico`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.otf` | Emit a separate file and return its public URL |

Images are embedded regardless of size unless you override their loader. If a large imported image should remain a separate file, set its extension to `file`.

When adding loaders, merge the existing object instead of replacing it:

```ts
// src/esbuild.settings.ts
import type { BuildOptions } from '@domstack/static/types.js'

export default function esbuildSettings (settings: BuildOptions): BuildOptions {
  return {
    ...settings,
    loader: {
      ...settings.loader,
      '.wasm': 'file',
    },
  }
}
```

Replacing `loader` without spreading `settings.loader` intentionally discards DOMStack's defaults. Review imported image and font output after upgrading, especially if URLs or bundle sizes are deployment-sensitive.

---

## Global data and page introspection additions

Values returned by `global.data.ts` are now passed to templates as part of `vars`, in addition to pages and layouts. A key returned by `global.data.ts` takes precedence over the same key from `global.vars.ts`. Check templates for variable-name collisions when upgrading.

`PageData` also has new helpers for collection processing:

- `readMarkdownContent()` reads the Markdown source body without frontmatter
- `renderInnerPage({ pages })` renders page content without its layout
- `renderFullPage({ pages })` renders the complete page

The resolved `page.vars` object is cached and shallow-frozen. Treat it as read-only rather than mutating it during collection processing. See [Page data and introspection](../README.md#page-data-and-introspection) for examples and rendering guidance.

---

## Markdown and frontmatter dependency updates

v12 updates the Markdown and frontmatter stack to `markdown-it` 15, `markdown-it-deflist` 4, and `js-yaml` 5. It also enables `markdown-it-github-alerts`, so GitHub-style `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, and `[!CAUTION]` blockquotes produce alert markup.

Most Markdown pages require no source changes. Sites should compare rendered output when they:

- Customize the parser through `markdown-it.settings.ts`
- Register third-party markdown-it plugins
- Depend on exact generated HTML in CSS, tests, or content transforms
- Use definition lists or unusual YAML frontmatter values

The alert plugin provides markup, not site-specific presentation. Import its styles or provide equivalent rules if you use alert blocks. See [Markdown settings](../README.md#markdown-itsettingsts) for DOMStack's default plugin list and override API.

---

## Generated pages

v12 adds `*.pages.ts` modules for creating normal layout-backed pages from data. A module may export one definition, an array, a sync or async factory, or an async iterable.

```ts
// src/archive.pages.ts
import type { PagesFunction } from '@domstack/static/types.js'

type ArchiveVars = { layout: string, year: number }
type SiteVars = { archiveYears: number[] }

const archivePages: PagesFunction<ArchiveVars, string, SiteVars> = ({ vars }) => {
  return vars.archiveYears.map(year => ({
    outputName: `archive/${year}/index.html`,
    vars: { layout: 'root', year },
    children: `<h1>${year}</h1>`,
  }))
}

export default archivePages
```

Generated pages use global and layout assets and participate in the final `pages` collection, output conflict detection, drafts, manifests, and progressive watch rebuilds. They do not have page-local `style.css`, `client.ts`, or `*.worker.ts` assets because they do not own a source page directory.

Factories receive source-backed pages and global data. They do not receive pages created by the same or another `*.pages.ts` file. Likewise, `results.siteData.pages` remains source discovery data and does not include generated pages. See [Generated Pages](../README.md#generated-pages) for all export forms, types, and lifecycle details.

---

## Programmatic test builds

v12 adds the `testBuild()` helper for isolated programmatic build tests. It creates a temporary destination, runs a build, and returns the build results plus the temporary path and a cleanup function.

```ts
// test/site.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { testBuild } from '@domstack/static'

test('builds the home page', async () => {
  const build = await testBuild('./src')

  try {
    const html = await build.readOutput('index.html')
    assert.match(html, /Hello/)
  } finally {
    await build.cleanup()
  }
})
```

This is additive. Existing tests that construct `DomStack` directly can continue to do so. See [Programmatic test builds](../README.md#programmatic-test-builds) for the complete return shape and repository examples.

---

## DOMStack manifest and service workers

v12 adds first-class site service-worker builds and an unstable-preview DOMStack manifest pipeline for static caching.

The service-worker entrypoint and build API are stable. The DOMStack manifest API is not: its option shapes, schema, generated output, and runtime semantics may change outside of a major version while it is validated with real PWA use cases. Pin `@domstack/static` to an exact version if you rely on the manifest contract.

### Add a site service worker

A service worker is the browser entrypoint that installs cache contents, intercepts requests, and applies offline/update behavior. DOMStack now discovers one `service-worker.*` source module anywhere under `src` and bundles it to the stable public URL `/service-worker.js`.

DOMStack does not register the service worker for you. Your app owns registration timing, update prompts, local-development opt-outs, reset/recovery behavior, route filtering, offline fallback behavior, and runtime cache policy.

The service worker can read DOMStack's build-time browser defines:

| Define | Value |
| --- | --- |
| `process.env.DOMSTACK_MANIFEST_URL` | Standard public URL for the built-in manifest, `/domstack-manifest.json` |
| `process.env.DOMSTACK_MANIFEST_VERSION` | Finalized manifest version in `/service-worker.js`; `""` in other bundles |
| `process.env.DOMSTACK_MANIFEST_ENABLED` | `"true"` for one-shot builds with an enabled manifest pipeline, `"false"` when disabled or in watch mode |
| `process.env.DOMSTACK_SERVICE_WORKER_URL` | Public URL of the site service worker, usually `/service-worker.js`, or `""` when no service worker is present |
| `process.env.DOMSTACK_SERVICE_WORKER_SCOPE` | Registration scope for the site service worker, usually `/`, or `""` when no service worker is present |

### Configure the manifest in a settings module

Add one `domstack-manifest.settings.*` module anywhere under `src`, using the same supported module extensions as other DOMStack settings files. The settings module enables the manifest pipeline and is the primary place to select application vars, define root policy, filter entries, and register build hooks.

Use `manifestVars` to expose selected page, layout, global, or default vars on manifest entries. Use `policy` for values shared by the whole application. Use `includeEntry(entry)` and `exclude` to filter final public output entries.

```ts
import type { DomstackManifestOptions } from '@domstack/static/types.js'

const settings = {
  manifestVars: ['offline', 'precache'],
  policy: {
    offlineFallbackUrl: '/offline/',
  },
  exclude: ['admin/**', 'blog/**', '**/*.map'],
  includeEntry (entry) {
    if (entry.kind === 'metadata') return false
    if (entry.kind === 'sourcemap') return false
    if (entry.manifestVars?.offline === false) return false
    if (entry.manifestVars?.precache === false) return false
    return true
  },
} satisfies DomstackManifestOptions

export default settings
```

A settings module returns `results.domstackManifest` and runs manifest hooks, but does not write public JSON unless writing is explicitly enabled.

### Inject finalized policy into the service worker

The primary service-worker integration point is `hooks.manifestBuilt`.
This hook receives the finalized manifest before the final `/service-worker.js` bundle is emitted.
Use `context.defineServiceWorkerConstant()` to inject JSON-serializable policy directly into the service-worker bundle.

```ts
import type {
  DomstackManifestBuiltHookContext,
} from '@domstack/static/types.js'

export async function injectServiceWorkerPolicy (
  context: DomstackManifestBuiltHookContext
): Promise<void> {
  context.defineServiceWorkerConstant('__APP_CACHE_POLICY__', {
    version: context.manifest.version,
    precacheEntries: context.manifest.entries.map(entry => ({
      url: entry.url,
      revision: entry.urlRevisioned ? null : entry.revision,
    })),
  })
}
```

Bundling the finalized URL/revision list into the service worker is the standard precache workflow: the installed worker receives policy for exactly the outputs produced by the same build. If you intentionally need a separate custom artifact, write it from the hook with `context.writeFile()`.

### Optionally write a public manifest

Most service-worker integrations only need the settings module and `manifestBuilt` hook. Write `/domstack-manifest.json` when another runtime or deployment tool needs to fetch the manifest:

```sh
domstack --domstackManifest
```

Programmatic builds can opt in with `domstackManifest: true`; the object form is available for callers that need to override settings or writing behavior.

### Use `--serve` for PWA testing

Watch mode intentionally does not write or return the domstack manifest.
It still rebuilds the site service worker, but watch-mode output is not representative of production cache invalidation.

Use `--serve` when testing PWA install/update/offline lifecycle behavior:

```sh
domstack --serve
```

Add `--domstackManifest` only if you also want to serve the public `domstack-manifest.json` file while debugging:

```sh
domstack --serve --domstackManifest
```

### Avoid circular manifest dependencies

The built-in manifest file is never included in its own `entries`.
Site service workers are also omitted from manifest entries.
This lets DOMStack inject the finalized `manifest.version` into `/service-worker.js` without making the manifest hash depend on the service-worker hash.

---

## Migration checklist

- [ ] Run development, CI, and deployment builds on Node.js 22 LTS or Node.js 24+. Do not use Node.js 23.
- [ ] If you import public types from `@domstack/static`, update those imports to `@domstack/static/types.js`.
- [ ] If you rely on BrowserSync-specific dev-server behavior, test watch mode with `@domstack/sync`.
- [ ] If you use the new `--serve` preview, keep it separate from watch modes and use `--port` only with `--serve`.
- [ ] If you rely on the bundled default layout, make sure pages and child layouts return HTML strings or `fragtml` template results, not Preact or HTM VNodes.
- [ ] If any layout module already exports a named `vars` value, confirm it should now act as layout defaults.
- [ ] If you want to keep the v11 Preact default layout, eject on v11 before upgrading to v12.
- [ ] If your ejected layout or server-side pages still import `htm/preact`, `preact`, or `preact-render-to-string`, keep those dependencies in your own `package.json`.
- [ ] If you want your ejected server-side layout to match the v12 default, migrate its templates to `fragtml` and install `fragtml`.
- [ ] If you use `.jsx` or `.tsx` browser clients, add an `esbuild.settings` file that configures your JSX runtime.
- [ ] If you use `domstack --target` or `domstack -t`, move that target list to `esbuild.settings.*`.
- [ ] Review browser imports of images, icons, and fonts against v12's default esbuild loaders.
- [ ] Merge `settings.loader` when adding custom esbuild loaders unless you intentionally want to discard DOMStack's defaults.
- [ ] If you use Preact browser clients, keep `preact` in your project dependencies.
- [ ] If you directly consume mine.css or ejected DOMStack's defaults, read the mine.css v11 migration guide.
- [ ] In direct or ejected stylesheets, replace `@import 'mine.css/dist/mine.css'` with `@import 'mine.css'` and keep optional sidecars explicit.
- [ ] In direct or ejected clients, remove `toggleTheme()`, theme-switcher imports, persisted theme state, theme controls, and light/dark mode classes.
- [ ] Add `<meta name="color-scheme" content="light dark">` to custom root layouts that use mine.css and use `prefers-color-scheme` for dark styles.
- [ ] If desired, organize custom global, layout, and page rules in their corresponding optional `domstack.*` layers.
- [ ] In ejected stylesheets, load light and dark syntax-highlighting themes with matching `prefers-color-scheme` behavior.
- [ ] If installing mine.css directly, confirm the environment uses Node.js 22+ and npm 10+ and target browsers support native CSS nesting.
- [ ] Visually check mine.css surfaces that the project directly customizes.
- [ ] If templates consume `vars`, check for keys newly supplied by `global.data.ts`, which override matching `global.vars.ts` keys.
- [ ] If you customize Markdown, use parser plugins, or snapshot rendered HTML, verify output with the v12 Markdown and YAML dependency versions.
- [ ] If you use GitHub alert blocks, import alert styles or provide equivalent site styles.
- [ ] Treat `PageData.vars` as read-only and use the new Markdown and rendering helpers when processing page collections.
- [ ] If adopting `*.pages.ts`, verify output names, source-backed page assumptions, and the lack of page-local assets.
- [ ] If adopting the manifest preview, pin an exact DOMStack prerelease and test service-worker lifecycle behavior with `--serve`.
