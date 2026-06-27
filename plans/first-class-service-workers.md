# First-Class Service Workers

## Status: Implemented as unstable preview in the stacked PR

This feature is intentionally documented as an unstable preview. The service-worker source convention,
generated output shape, browser defines, manifest integration, and lifecycle semantics may change
outside of a major version while downstream PWA use cases validate the API.

## Branch Coordination

- Domstack implementation branch: `staic-client-cache`.
- Downstream validation branch: Breadcrum `pwa-cache-only`.
- Breadcrum's branch exercises the first-class service worker entry through
  `packages/web/client/globals/service-worker.ts`.

## Goal

Add explicit service worker support to domstack so sites do not need to emit `/service-worker.js`
through a template or copy workaround.

The existing `*.worker.{js,ts}` support is for page-scoped Web Workers. Service workers have
different requirements:

- They need a stable URL, usually `/service-worker.js`, so browser update checks work correctly.
- They usually need root scope.
- They should not be content-hashed in the output filename.
- They should be included in the domstack manifest so PWA tooling can reason about them.
- They should be built by esbuild so TypeScript, ESM imports, and bundling work consistently.

## Non-Goals

- Do not add a post-build template phase.
- Do not generate a default service worker.
- Do not implement data sync, offline mutations, or app-specific cache policy.
- Do not make watch mode write `domstack-manifest.json`.

## Source Conventions

Domstack supports one site-level service worker entry point anywhere under `src`, matching domstack's other
global asset patterns:

```txt
src/
  globals/
    service-worker.js
    service-worker.ts
```

Supported JavaScript filenames are `service-worker.js`, `service-worker.mjs`, and
`service-worker.cjs`. When Node's TypeScript support is available, `service-worker.ts`,
`service-worker.mts`, and `service-worker.cts` are also supported.

Only one service worker entry is allowed. If multiple forms are present anywhere in `src`, domstack
fails with a clear duplicate-entry error.

The output is:

```txt
public/service-worker.js
```

This is intentionally stable and un-hashed. Any imports/chunks produced by the service worker can use
the normal chunk naming rules.

## Build Pipeline

1. `identifyPages()` detects a site service worker entry and stores it on `siteData.serviceWorker`.
2. Production `buildEsbuild()` runs the normal hashed-entry build for page/global assets, then runs a
   small second esbuild build for the service worker with `entryNames: '[name]'` so the output remains
   `/service-worker.js`.
3. Watch mode adds the service worker as an object entry point in the esbuild watch context and uses
   stable entry names for all watched entries.
4. `createEsbuildOutputRecords()` classifies the root output as `kind: 'service-worker'`.
5. `buildDomstackManifest()` includes the service worker entry like any other emitted output during
   one-shot builds.

The service worker itself can fetch `/domstack-manifest.json` at runtime with `cache:
'no-store'`, open a versioned cache using `manifest.version`, and precache selected manifest entries.

## Esbuild Details

The service worker entry uses a stable output name even when other production entry points use hashed
entry names. Production intentionally uses a separate service-worker build because esbuild's
`entryNames` pattern applies to every entry point in a build. Keeping the root service-worker URL
stable without de-hashing all other entries is simpler and less fragile as a second build.

The service-worker build reuses the extended esbuild options, including user settings, loaders,
targets, plugins, and domstack's reserved browser defines. The metafiles from the normal build and
service-worker build are merged before output records are classified.

## Manifest Schema Changes

Add a new output kind:

```ts
type DomstackManifestKind =
  | ...
  | 'service-worker'
```

The manifest entry should include:

```ts
{
  kind: 'service-worker',
  outputRelname: 'service-worker.js',
  url: '/service-worker.js',
  sourceRelname: 'service-worker.js'
}
```

Regenerate `lib/domstack-manifest/schema.json` with `npm run build:schema`.

## Watch Mode

Watch mode should build and rebundle the service worker as part of esbuild watch, but it should keep
the current manifest behavior:

- no `results.domstackManifest`
- no `domstack-manifest.json`

This means watch mode can validate service worker bundling, but full PWA cache lifecycle testing
still requires a one-shot build.

## Registration

domstack should not auto-register the service worker. Registration belongs in site client code:

```js
if ('serviceWorker' in navigator) {
  await navigator.serviceWorker.register('/service-worker.js', { type: 'module' })
}
```

This keeps lifecycle UX, update prompts, and online/offline handling in the application.

## Tests

Fixture coverage includes:

- `service-worker.*` detection anywhere in `src` and output at `/service-worker.js`.
- TypeScript service-worker detection when Node TypeScript support is enabled.
- duplicate service worker source files fail clearly.
- service worker imports are bundled.
- domstack manifest includes `kind: 'service-worker'`.
- watch mode builds the service worker but does not write `domstack-manifest.json`.

## Breadcrum Usage

Breadcrum can replace its service-worker template/static workaround with:

```txt
packages/web/client/globals/service-worker.ts
```

That file should fetch `/domstack-manifest.json`, cache entries selected by Breadcrum policy,
apply update lifecycle handling, and leave data-model/offline mutation behavior for a later pass.
