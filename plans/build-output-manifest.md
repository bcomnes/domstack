# Build Output Manifest

## Status: Implemented

## Goal

Expose a complete, normalized manifest of files domstack emits so client sites can build service
workers, deploy manifests, cache policies, and audit tooling without re-scanning the output
directory or maintaining hand-written asset lists.

The main target use case is a static PWA/MPA:

- Build pages, bundles, copied files, and ordinary templates.
- Record each emitted output at the build step that wrote it.
- Reconcile those records into public URLs, content revisions, and a stable build version.
- Let a stable service worker fetch `domstack-output-manifest.json` at runtime and use it to drive
  cache installation.

## Design

The implementation keeps domstack's pipeline simple:

```txt
builder()
  identifyPages()
  ensureDest()
  Promise.all(
    buildEsbuild()  -> report.outputs
    buildStatic()   -> report.outputs
    buildCopy()     -> report.outputs
  )
  buildPages()      -> report.outputs for pages + templates
  buildOutputManifest(records)
  writeOutputManifest()
```

`buildPages()` does not know about esbuild/static/copy reports and does not reconcile the manifest.
It only renders pages/templates and reports the files it wrote.

## Output Record Model

Each build step emits `BuildOutputRecord` objects:

```ts
type BuildOutputKind =
  | 'page'
  | 'template'
  | 'script'
  | 'style'
  | 'chunk'
  | 'worker'
  | 'worker-manifest'
  | 'static'
  | 'copy'
  | 'sourcemap'
  | 'metadata'

type BuildOutputRecord = {
  outputRelname: string
  filepath: string
  kind: BuildOutputKind
  url?: string
  sourceRelname?: string
  entryPoint?: string
  pagePath?: string
  pageUrl?: string
  templatePath?: string
  page?: {
    path: string
    url: string
    vars?: {
      precache?: unknown
      offline?: unknown
    }
  }
}
```

The reconciler turns records into `BuildOutputEntry` objects by validating destination paths, hashing
file contents, adding byte sizes, deduping by `outputRelname`, sorting by URL, and applying filters.

## Manifest Object

```ts
type BuildOutputManifest = {
  $schema: typeof BUILD_OUTPUT_MANIFEST_SCHEMA_ID
  version: string
  generatedAt: string
  entries: BuildOutputEntry[]
}
```

`version` is a sha256 hash of sorted `(url, revision)` pairs. It does not depend on `generatedAt`.

Programmatic builds always return `results.outputManifest`. The CLI writes
`domstack-output-manifest.json` by default unless `--no-output-manifest` or
`outputManifest: false` is used.

domstack also exports `BUILD_OUTPUT_MANIFEST_SCHEMA_ID`, `BUILD_OUTPUT_MANIFEST_SCHEMA_PATH`,
`getBuildOutputManifestSchemaId(version)`, `buildOutputManifestSchema`, and the schema-derived public
manifest types.

## Breadcrum Usage

Breadcrum should ship a stable `service-worker.js` as a normal domstack template or static asset.
That service worker should:

1. Fetch `/domstack-output-manifest.json` with `cache: 'no-store'` during install.
2. Open a cache named from `manifest.version`.
3. Precache eligible `manifest.entries`.
4. Activate only after required entries are cached.
5. Delete old `domstack-precache-*` caches during activate.
6. Use cache-first or navigation-aware fetch handling for static URLs.

Docs/legal, login/register, password reset, and other static app/auth pages can remain in the
precache list. Runtime online/offline handling and data sync remain Breadcrum-side concerns.

## Implemented Work

- Added `lib/build-output-manifest/index.js`.
- Added `lib/build-output-manifest/schema.json`.
- Added output records to:
  - `buildEsbuild()`
  - `buildStatic()`
  - `buildCopy()`
  - `pageWriter()`
  - `templateBuilder()`
- Added `TemplateReport.outputFiles` and `TemplateReport.outputRecords` while preserving
  `TemplateReport.outputs`.
- Added destination escape protection for template output names.
- Added `results.outputManifest`.
- Added manifest writing controls:
  - `--output-manifest <filename>`
  - `--no-output-manifest`
  - `outputManifest.filename`
  - `outputManifest.write`
  - `outputManifest.exclude`
- Added `global.vars.js` `buildManifest.exclude` and `buildManifest.includeOutput(entry)` hooks.
- Fixed `metafile: false` so esbuild still produces internal metadata for output mapping but skips
  writing `domstack-esbuild-meta.json`.
- Left output manifests unsupported in watch mode to keep the development pipeline simple. Watch
  mode renders normal templates, but it does not write `domstack-output-manifest.json`.
- Documented the manifest API and service-worker runtime pattern in `README.md`.

## Verification

- `npm test`
- `npm pack --dry-run --json` confirms `lib/build-output-manifest/schema.json` is published.
