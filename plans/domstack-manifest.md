# Build Output Manifest

## Status: Implemented unstable preview

Domstack has an implemented build-output manifest preview.

The manifest pipeline is build-time first.

It exists primarily for `domstack-manifest.settings.*`, `hooks.manifestBuilt`, deployment metadata, auditing, and optional public `domstack-manifest.json` output.

Service-worker integrations now prefer injected constants from `manifestBuilt` hooks instead of runtime-fetching a generated manifest or policy file.

The API is still documented as preview-quality because service-worker and PWA use cases are actively shaping the final ergonomics.

## Current implementation

The implemented pipeline is:

```txt
builder()
  identifyPages()
  ensureDest()
  Promise.all(
    buildEsbuild()  -> output records for app bundles, excluding final /service-worker.js
    buildStatic()   -> output records
    buildCopy()     -> output records
  )
  buildPages()      -> output records for pages/templates
  buildDomstackManifest(records) when a manifest consumer exists
  run manifestBuilt hooks
  build /service-worker.js with finalized manifest version and hook-defined constants
  optionally write domstack-manifest.json
```

A manifest consumer exists when either:

- a `domstack-manifest.settings.*` file is present
- explicit programmatic `domstackManifest` configuration is provided
- `--domstackManifest` is passed to the CLI

`domstack-manifest.json` is not written by default.

The CLI writes it only when `--domstackManifest` is passed.

Programmatic builds return `results.domstackManifest` when a manifest consumer exists.

## Service worker relationship

Production service workers are built after the manifest is finalized.

They are intentionally omitted from the manifest version hash.

This avoids a circular dependency where `/service-worker.js` would depend on `manifest.version` while also changing `manifest.version`.

Instead, service workers receive:

- `process.env.DOMSTACK_MANIFEST_VERSION`
- hook-defined constants from `context.defineServiceWorkerConstant()`

When manifest-driven service-worker policy changes, the final `/service-worker.js` bytes change, and the browser's normal service-worker update lifecycle runs.

Watch mode does not build a manifest.

Watch mode builds a self-contained no-policy `/service-worker.js` that can unregister itself and clear owned caches.

Watch mode also disables esbuild splitting so `/service-worker.js` remains parseable during production-to-watch cleanup, even for older classic-worker registrations.

## Manifest built hook API

Status: implemented.

`domstack-manifest.settings.*` and programmatic `domstackManifest.hooks` can register `manifestBuilt` hooks.

Hooks receive the finalized manifest after entry reconciliation, filtering, manifest variables, root policy, and `manifest.version` are resolved.

```ts
type DomstackManifestBuiltHookContext<Policy, ManifestVars> = {
  dest: string
  manifest: DomstackManifest<Policy, ManifestVars>
  defineServiceWorkerConstant: (identifier: string, value: unknown) => void
  writeFile: (outputRelname: string, contents: string | Uint8Array) => Promise<void>
}
```

`defineServiceWorkerConstant()` serializes `value` with `JSON.stringify()` and passes it to esbuild's `define` option for the final service-worker build.

Use it for service-worker policy, Workbox precache data, or any other build-time data that should not require a runtime fetch.

`writeFile()` writes custom generated artifacts into `dest`.

Use it for deployment metadata or public files that intentionally need their own URL.

## Current manifest shape

Relevant public entry fields include:

```ts
type DomstackManifestEntry<ManifestVars = Record<string, unknown>> = {
  outputRelname: string
  kind: DomstackManifestKind
  url: string
  revision: string | null
  bytes: number | null
  sourceRelname?: string
  entryPoint?: string
  pagePath?: string
  pageUrl?: string
  templatePath?: string
  contentType?: string
  integrity?: string
  manifestVars?: ManifestVars
  urlRevisioned?: boolean
  static?: boolean
  role?: string
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

Relevant root fields include:

```ts
type DomstackManifest<Policy, ManifestVars> = {
  $schema: typeof DOMSTACK_MANIFEST_SCHEMA_ID
  version: string
  generatedAt: string
  entries: DomstackManifestEntry<ManifestVars>[]
  policy?: Policy
}
```

`version` is a SHA-256 hex digest derived from stable cache-relevant manifest data.

It excludes `generatedAt` and excludes the final `/service-worker.js` output.

## Manifest variables and policy

`manifestVars` are selected from the resolved page variable cascade.

The current cascade is:

```txt
page vars -> layout vars -> global vars -> defaults
```

Layouts can export `vars` with the same async/sync contract as page/global vars.

`manifestVars` can be configured as an array of variable names or a transform function.

Root `policy` is a single freeform object for the whole manifest.

Per-entry policy is represented through selected `manifestVars`, not a separate per-entry policy object.

## Examples validating the preview

`examples/static-mpa-offline` demonstrates a domstack-native service worker.

It injects manifest-shaped service-worker policy directly into `/service-worker.js` with `defineServiceWorkerConstant()`.

The service worker consumes Domstack manifest entries directly and derives cache behavior from:

- `entry.manifestVars`
- `entry.role`
- `entry.kind`
- `entry.revision`
- `entry.urlRevisioned`
- `entry.bytes`
- `entry.static`

`examples/static-mpa-workbox-offline` demonstrates a Workbox service worker.

It injects a Workbox-oriented policy constant into `/service-worker.js`.

The service worker passes `policy.precacheManifest` to Workbox and maps app-specific runtime/network-only/fallback policy to Workbox routing and strategies.

## Public schema artifact

`lib/domstack-manifest/schema.json` is currently kept as a public validation/documentation artifact.

Runtime/build behavior does not require loading this file.

It is useful for users who opt into writing `domstack-manifest.json` and want editor or deployment validation.

If the written manifest is de-emphasized further, this schema file could become optional or be replaced by docs-only schema publication.

## Current non-goals

- Do not auto-register service workers.
- Do not require Workbox.
- Do not require writing `domstack-manifest.json` for service-worker use.
- Do not encode app-specific API/data caching semantics in core manifest fields.
- Do not include final `/service-worker.js` in the manifest hash.

## Potential follow-ups

- Decide whether the external schema JSON remains a packaged artifact long term.
- Consider helper utilities for common service-worker policy derivations without making them mandatory.
- Consider a small registration helper that uses Domstack's service-worker URL/scope defines but leaves UI policy to the app.
- Continue validating downstream PWA use cases before stabilizing the preview API.
