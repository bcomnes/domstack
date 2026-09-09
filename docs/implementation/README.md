---
layout: docs
handlebars: false
---

<a id="build-internals"></a>

# Implementation

DOMStack coordinates page rendering, asset bundling, and file copying in a staged build.
This guide explains the tools involved, the order of each phase, and how watch mode decides what to rebuild.

## Table of Contents

[[toc]]

## Build tools

`domstack` bundles the best tools for every technology in the stack:

- `js` and `css` is bundled with [`esbuild`](https://github.com/evanw/esbuild).
- `md` is processed with [markdown-it](https://github.com/markdown-it/markdown-it).
- static files are processed with [cpx2](https://github.com/bcomnes/cpx2).
- `ts` support via native typestripping in Node.js and esbuild.
- `jsx/tsx` support via esbuild.

These tools are treated as implementation details, but they may be exposed more in the future.
The idea is that they can be swapped out for better tools in the future if they don't make it.

## Build process flow

The one-shot builder discovers inputs using the shared file conventions, then records outputs from each build phase.
The service worker is built last so manifest hooks can provide its build-time constants.

<pre class="mermaid">
flowchart TD;
  IDENTIFY["identifyPages(): discover source inputs"] --> PREPARE["Prepare destination and resolve manifest options"];
  PREPARE --> ESBUILD["Bundle browser assets, excluding the service worker"];
  PREPARE --> STATIC["Copy static assets when enabled"];
  PREPARE --> COPY["Copy additional directories"];
  ESBUILD --> PAGES["buildPages(): render pages and templates in a fresh worker"];
  STATIC --> PAGES;
  COPY --> PAGES;
  PAGES --> ENABLED{"Manifest pipeline enabled?"};
  ENABLED -->|Yes| MANIFEST["Reconcile output records, hash contents, and compute manifest version"];
  MANIFEST --> HOOKS["Run manifest hooks and collect service-worker defines"];
  ENABLED -->|No| WORKER["Build the service worker if present"];
  HOOKS --> WORKER;
  WORKER --> RESULTS["Write manifest JSON if requested; return build results"];
</pre>

The build process follows these key steps:

1. **Page identification** - Scans the source directory to identify all pages, layouts, templates, and global assets
2. **Destination preparation** - Ensures the destination directory is ready for the build output
3. **Parallel asset processing** - Three operations run concurrently and record their outputs:
   - JavaScript and CSS bundling via esbuild
   - Static file copying (when enabled)
   - Additional directory copying (from `--copy` options)
4. **Page building** - Initializes source-backed pages, derives global data, generates pages, and renders pages and templates with their declared data subscriptions
5. **Manifest reconciliation** - When enabled, normalizes recorded outputs, hashes file contents, filters entries, computes a stable manifest version, and runs manifest hooks
6. **Service-worker building** - Bundles the site service worker using any defines returned by manifest hooks; this output is not included in the already reconciled manifest
7. **Return results** - Writes manifest JSON only when requested and returns the build results

This architecture allows for efficient parallel processing of independent tasks while maintaining the correct build order dependencies.
The diagrams show successful execution; discovery and build errors stop later phases.

<a id="buildpages-detail"></a>

### buildPages() detail

Each `buildPages()` call starts a fresh worker so server-side modules can be reloaded between watch builds.
Within that worker, source-backed pages are initialized before global data is computed.
Generated pages are downstream consumers of that data, not inputs to its producer.

<pre class="mermaid">
flowchart TD;
  BUILD["Start page worker"] --> RESOLVE["Resolve defaults, global vars, and layouts; validate layout chains"];
  RESOLVE --> INIT["Initialize all source pages: vars, selected layout chains, assets, and dataDeps"];
  INIT --> DATA["Run global.data with initialized source pages"];
  DATA --> FILTERS["In watch mode, compare data keys and expand filters to affected subscribers"];
  FILTERS --> GENERATED["Run selected pages-file factories with their declared data"];
  GENERATED --> GENERATED_INIT["Initialize generated pages and their layout chains"];
  GENERATED_INIT --> PAGE_RENDER["Render selected source and generated pages; wrap layouts inner to outer"];
  GENERATED_INIT --> TEMPLATE_RENDER["Render selected templates with their declared data"];
  PAGE_RENDER --> REPORT["Return outputs, errors, and layout reports; include subscriptions in watch mode"];
  TEMPLATE_RENDER --> REPORT;
</pre>

Each page, layout, template, and pages-file factory receives only the global-data keys it declares through `dataDeps`.
Layout subscriptions contribute to page invalidation, but each layout still receives its own data projection while rendering.
Page initialization uses a concurrency limit of `min(CPUs, 24)`.
The final page and template rendering queues run in parallel, splitting that concurrency budget between them.

Variable Resolution Layers, from lowest to highest precedence:
- **Domstack defaults** - Internal defaults such as the default `layout: 'root'`.
- **Global vars** - Site-wide variables from `global.vars.js` (resolved once).
- **Layout vars** - Optional `export const vars` from the resolved layout chain, merged outermost to innermost.
- **Page-specific vars** vary by type:
  - **MD pages**: `page.vars.js` plus builder vars from frontmatter.
  - **HTML pages**: `page.vars.js`.
  - **JS pages**: exported `vars` plus `page.vars.js`.

Global data is not a variable-resolution layer.
It is resolved separately and projected into each consumer's `data` argument according to `dataDeps`.

## Watch mode

Running `domstack --watch` or `domstack -w` performs an initial build, watches the source inputs, and serves `dest` with live reload.
Use `domstack --watch-only` when another process serves the output.

Watch mode coordinates three independent watchers:

- **esbuild** uses `context.watch()` for global, layout, and page client bundles, styles, page-scoped Web Workers, and the site service worker.
- **chokidar** watches page, layout, template, generated-pages, variable, and settings modules.
  DOMStack uses the changed file and its dependency maps to choose a rebuild scope.
- **cpx2** watches static assets under `src` and directories supplied with `--copy`, copying or removing their destination files directly.

Chokidar events pass through a pure planner before any rebuild executes.
The planner reads an explicit snapshot of discovery, dependency maps, and the previous page-build outcome; it does not perform I/O or mutate that state.
`DomStack` owns the watch session, serializes events, executes plans, and releases its watchers, esbuild context, and server on shutdown.

<pre class="mermaid">
flowchart TD;
  EVENT["Chokidar event"] --> QUEUE["Serialize within the active watch session"];
  QUEUE --> CLASSIFY["Classify using shared file conventions"];
  CLASSIFY --> PLAN["planWatchEvent(): inspect the watch snapshot"];
  PLAN --> EXECUTE{"DomStack executes the plan"};
  EXECUTE -->|Skip| SKIP["No page rebuild"];
  EXECUTE -->|Full| FULL["Rediscover inputs and restart esbuild"];
  EXECUTE -->|Restart| RESTART["Rediscover bundle entries and restart esbuild"];
  RESTART --> BUNDLE["planBundleChange(): use refreshed discovery and last successful layout routing"];
  BUNDLE --> EXECUTE;
  EXECUTE -->|Pages| PAGES["Run full or filtered page phase"];
  FULL --> PAGES;
  PAGES --> SUCCESS{"Page build succeeded?"};
  SUCCESS -->|Yes| SAVE["Reconcile owned outputs and refresh routing and subscription state"];
  SUCCESS -->|No| RETAIN["Retain successful ownership and routing reports; mark full page retry"];
</pre>

Bundle replanning returns only a page plan or a skip; it does not restart esbuild again.
After a page-build failure, the next page-producing plan retries the complete page phase rather than trusting incremental filters.
Manifest-settings changes and service-worker entry additions or removals retain their intentional page-phase skips.
The one-shot manifest pipeline is not part of watch execution.

> [!NOTE]
> The filenames below use `.ts` by default.
You can also use `.js`, and TypeScript client bundles can use `.tsx`.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions.

DOMStack uses these rebuild scopes:

- **esbuild only**: esbuild updates an existing browser entry without rendering HTML.
- **Targeted page/template rebuild**: DOMStack renders only the affected source-backed pages or templates.
- **Targeted generated-pages rebuild**: DOMStack renders and reconciles only the outputs owned by affected `*.pages.ts` files.
- **Full page/template rebuild**: DOMStack renders every source-backed and generated page and every template without restarting esbuild.
- **Full rebuild**: DOMStack rediscovers the source tree, restarts esbuild, renders all pages and templates, and refreshes its dependency maps.

Like templates, generated-pages modules rebuild when their own source or imported dependencies change.
When a targeted build recomputes global data, DOMStack compares top-level values with the previous successful build and adds only subscribers of changed keys to the rebuild set.

### What triggers what

| Change | Rebuild scope |
|---|---|
| Existing `page.ts`, `page.html`, `page.md`, or adjacent `page.vars.ts` | That page, plus subscribers of any changed global-data keys |
| A module imported by a TypeScript page or `page.vars.ts` | Pages that depend on it, plus subscribers of any changed global-data keys |
| Existing `*.layout.ts` or a module it imports | Source-backed pages and generated-page owners using the affected layout |
| Existing `*.template.ts` or a module it imports | Affected templates |
| Existing `*.pages.ts` | Generated outputs owned by that file, then refresh dependency maps |
| A module imported by `*.pages.ts` | Generated outputs owned by the importing files, then refresh dependency maps |
| `markdown-it.settings.ts` | All source-backed Markdown pages, plus subscribers of any changed global-data keys |
| `global.data.ts` | Consumers subscribed to top-level keys whose values changed |
| `global.vars.ts` or `esbuild.settings.ts` | Full rebuild |
| `domstack-manifest.settings.ts` | No rebuild. The manifest pipeline is disabled in watch mode |
| Existing client, style, Web Worker, or service-worker entry | esbuild only, unless the same module also has server-side consumers |
| Static asset under `src` or a file under a `--copy` directory | cpx2 copies or removes the output directly |

Adding or removing a file changes the set of discovered build inputs:

| Added or removed file | Rebuild scope |
|---|---|
| Site `service-worker.ts` | Restart esbuild. No page rebuild |
| `global.client.ts` or `global.css` | Restart esbuild and rebuild all pages |
| Layout client or style | Restart esbuild and rebuild source-backed pages and generated-page owners using that layout |
| Page client, style, or Web Worker | Restart esbuild and rebuild that page |
| Any other page, layout, template, generated-pages, variable, or settings file | Full rebuild |

When a full page/template rebuild or targeted generated-pages rebuild no longer claims an output from the previous successful build, DOMStack removes that obsolete page or template output from `dest` without touching outputs owned by unaffected files.

### Dependency tracking

DOMStack uses [`@11ty/dependency-tree-typescript`](https://github.com/11ty/dependency-tree-typescript) to statically analyze ESM imports.
It maintains maps for:

- Layout dependencies, source-backed pages using each layout, and generated-page owner layout membership
- TypeScript pages and adjacent page-variable dependencies
- Template dependencies
- Generated-pages module dependencies
- Current esbuild entry points

The maps are created after the initial build and refreshed after successful page builds and structural rediscovery.
Layout routing and generated-output ownership use reports from successful page builds.
Dependency analysis is best-effort.
When DOMStack cannot safely determine a targeted scope, it falls back to a broader rebuild or skips an unrelated changed module.

esbuild tracks browser-entry dependencies independently.
Changing a module imported only by `client.ts` rebundles that entry without rendering page HTML.
When a module has both browser and server-side consumers, the planner unions the server-side consumers rather than skipping the page phase.

### Stable entry filenames

Watch mode uses stable filenames for esbuild entry outputs:

```text
[dir]/[name]
```

Production builds use content-hashed entry filenames:

```text
[dir]/[name]-[hash]
```

Shared chunks remain content-hashed in both modes:

```text
chunks/[ext]/[name]-[hash]
```

Page HTML points to stable entry files during watch mode. esbuild can update an entry and its chunk imports without requiring DOMStack to render the page again.

### Manifest behavior

Watch mode builds and rebundles the site service worker, but it does not finalize, return, or write the [DOMStack manifest](../../docs/workers/#domstack-manifest).
Changes to `domstack-manifest.settings.ts` therefore do not trigger a watch rebuild.

Use `domstack --serve` when testing manifest-driven cache behavior.
It runs a one-shot build and serves the result without watch-mode filenames or live-reload HTML injection.
Add `--domstackManifest` only when the service worker or test needs the public `domstack-manifest.json` file.

### Build serialization

Chokidar events are serialized through a promise chain.
Each page rebuild or esbuild restart completes before the next queued filesystem event is processed, preventing overlapping DOMStack rebuilds during rapid saves.

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
