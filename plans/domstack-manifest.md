# Build Output Manifest

## Status: Implemented as unstable preview

This feature is intentionally documented as an unstable preview. The option names, manifest schema,
generated output shape, browser defines, and service-worker integration semantics may change outside
of a major version while downstream PWA use cases validate the API.

## Branch Coordination

- Domstack implementation branch: `staic-client-cache`.
- Downstream validation branch: Breadcrum `pwa-cache-only`.
- Breadcrum's branch uses this Domstack branch through a local link while the
  API is unreleased. After this branch lands and is released, Breadcrum should
  replace the local link with the released `@domstack/static` version.

## Goal

Expose a complete, normalized manifest of files domstack emits so client sites can build service
workers, deploy manifests, cache policies, and audit tooling without re-scanning the output
directory or maintaining hand-written asset lists.

The main target use case is a static PWA/MPA:

- Build pages, bundles, copied files, and ordinary templates.
- Record each emitted output at the build step that wrote it.
- Reconcile those records into public URLs, content revisions, and a stable build version.
- Let a stable service worker fetch `domstack-manifest.json` at runtime and use it to drive
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
  buildDomstackManifest(records)
  writeDomstackManifest()
```

`buildPages()` does not know about esbuild/static/copy reports and does not reconcile the manifest.
It only renders pages/templates and reports the files it wrote.

## Output Record Model

Each build step emits `DomstackManifestRecord` objects:

```ts
type DomstackManifestKind =
  | 'page'
  | 'template'
  | 'script'
  | 'style'
  | 'chunk'
  | 'worker'
  | 'worker-manifest'
  | 'service-worker'
  | 'static'
  | 'copy'
  | 'sourcemap'
  | 'metadata'

type DomstackManifestRecord = {
  outputRelname: string
  filepath: string
  kind: DomstackManifestKind
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

The reconciler turns records into `DomstackManifestEntry` objects by validating destination paths, hashing
file contents, adding byte sizes, deduping by `outputRelname`, sorting by URL, and applying filters.

## Manifest Object

```ts
type DomstackManifest = {
  $schema: typeof DOMSTACK_MANIFEST_SCHEMA_ID
  version: string
  generatedAt: string
  entries: DomstackManifestEntry[]
}
```

`version` is a sha256 hash of sorted cache-relevant fields: `url`, `revision`, `kind`, and
page-level `precache` / `offline` vars. It does not depend on `generatedAt`.

Programmatic builds always return `results.domstackManifest`. The CLI writes
`domstack-manifest.json` by default unless `--noDomstackManifest` or
`domstackManifest: false` is used.

domstack also exports `DOMSTACK_MANIFEST_SCHEMA_ID`, `DOMSTACK_MANIFEST_SCHEMA_PATH`,
`getDomstackManifestSchemaId(version)`, `domstackManifestSchema`, and the schema-derived public
manifest types.

## Breadcrum Usage

Breadcrum should ship a first-class `service-worker.*` source under its domstack `src` tree so
domstack bundles it to the stable root `/service-worker.js` URL and records it as
`kind: 'service-worker'` in the generated manifest. That service worker should:

1. Fetch `/domstack-manifest.json` with `cache: 'no-store'` during install.
2. Open a cache named from `manifest.version`.
3. Precache eligible `manifest.entries` selected by Breadcrum policy.
4. Activate only after required entries are cached.
5. Delete old `domstack-precache-*` caches during activate.
6. Use cache-first or navigation-aware fetch handling for static URLs.

Docs/legal, login/register, password reset, and other static app/auth pages can remain in the
precache list. Runtime online/offline handling and data sync remain Breadcrum-side concerns.

## Needed: Manifest Post-Processing API

The current preview writes Domstack's native `domstack-manifest.json` format. That is enough for a
hand-rolled service worker, but Workbox and similar tools generally expect their own build-time
manifest shape. For example, Workbox's recommended runtime API is:

```js
precacheAndRoute(self.__WB_MANIFEST)
```

where `self.__WB_MANIFEST` is replaced at build time with an array of `{ url, revision }` entries.
A Workbox integration can derive that array from `DomstackManifest.entries`, but Domstack needs a
first-class post-processing hook so applications do not need an ad-hoc script that edits generated
files after every build.

A future API should let users take the finalized Domstack manifest and write one or more additional
artifacts in alternate formats. The hook should run after record reconciliation and manifest
filtering, but before build results are returned and before `--serve` begins serving `dest`.

Possible shape:

```ts
type DomstackManifestPostprocessContext = {
  dest: string
  manifestFilename: string
  manifestPath: string
}

type DomstackManifestPostprocessOutput = {
  filename: string
  contents: string | Uint8Array
  kind?: 'metadata' | 'worker-manifest'
}

type DomstackManifestPostprocess = (
  manifest: DomstackManifest,
  context: DomstackManifestPostprocessContext
) =>
  | DomstackManifestPostprocessOutput
  | DomstackManifestPostprocessOutput[]
  | Promise<DomstackManifestPostprocessOutput | DomstackManifestPostprocessOutput[]>
```

Example Workbox-oriented usage:

```js
export default {
  postprocess (manifest) {
    const entries = manifest.entries.map(entry => ({
      revision: entry.revision,
      url: entry.url,
    }))

    return {
      filename: 'workbox-manifest.json',
      contents: JSON.stringify(entries),
      kind: 'worker-manifest',
    }
  },
}
```

Open design questions:

- Should postprocessors live under `domstack-manifest.settings.*`, programmatic
  `domstackManifest.postprocess`, or both?
- Should the hook only write additional files, or should it also be allowed to transform the native
  Domstack manifest before it is written?
- Should multiple named postprocessors be supported so a project can write Workbox, deployment, and
  audit manifests in one build?
- Should postprocessed outputs be included in `results.domstackManifest.entries`, excluded from the
  native manifest, or reported separately to avoid changing the manifest version?
- Should Domstack provide helpers for common adapters such as Workbox `{ url, revision }` entries,
  or leave adapters entirely in application code during the unstable preview?

The safest initial API is additive and side-effect-minimal: accept the finalized manifest, return
extra output files for Domstack to validate and write inside `dest`, record those files as metadata,
and do not let the hook mutate the native manifest object in place.

## Implemented Work

- Added `lib/domstack-manifest/index.js`.
- Added `lib/domstack-manifest/schema.json`.
- Added output records to:
  - `buildEsbuild()`
  - `buildStatic()`
  - `buildCopy()`
  - `pageWriter()`
  - `templateBuilder()`
- Simplified build reports so emitted files flow through `report.outputs`.
- Added destination escape protection for template output names.
- Added `results.domstackManifest`.
- Added manifest writing controls:
  - `--customDomstackManifestName <filename>`
  - `--noDomstackManifest`
  - `domstackManifest.filename`
  - `domstackManifest.write`
  - `domstackManifest.exclude`
- Added `domstack-manifest.settings.*` `filename`, `exclude`, and `includeEntry(entry)` hooks.
- Added first-class `service-worker.*` detection/build support with a stable `/service-worker.js` output.
- Fixed `metafile: false` so esbuild still produces internal metadata for output mapping but skips
  writing `domstack-esbuild-meta.json`.
- Left domstack manifests unsupported in watch mode to keep the development pipeline simple. Watch
  mode renders normal templates, but it does not write `domstack-manifest.json`.
- Documented the manifest API and service-worker runtime pattern in `README.md`.

## Verification

- `npm test`
- `npm pack --dry-run --json` confirms `lib/domstack-manifest/schema.json` is published.
