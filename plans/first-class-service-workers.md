# First-Class Service Workers

## Status: Implemented in the stacked PR

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

## Proposed Source Conventions

Support one site-level service worker entry point anywhere under `src`, matching domstack's other
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

Only one service worker entry should be allowed. If multiple forms are present anywhere in `src`,
fail with a clear duplicate-entry error.

The output should be:

```txt
public/service-worker.js
```

This is intentionally stable and un-hashed. Any imports/chunks produced by the service worker can use
the normal chunk naming rules.

## Build Pipeline

1. `identifyPages()` detects a site service worker entry and stores it on `siteData.serviceWorker`.
2. `buildEsbuild()` adds that entry to esbuild's entry points.
3. esbuild emits the entry as `service-worker.js` at the destination root.
4. `createEsbuildOutputRecords()` classifies it as `kind: 'service-worker'`.
5. `buildDomstackManifest()` includes the service worker entry like any other emitted output.

The service worker itself can fetch `/domstack-manifest.json` at runtime with `cache:
'no-store'`, open a versioned cache using `manifest.version`, and precache selected manifest entries.

## Esbuild Details

The service worker entry should use a stable output name even when other entry points use hashed
entry names.

Options to evaluate:

- Use esbuild object entry points with `out: 'service-worker'` and keep `entryNames` compatible.
- If global `entryNames` would still hash the entry, run a small separate esbuild build for the
  service worker after the main asset build.

Prefer one esbuild build if it stays simple. Use a separate build only if per-entry naming becomes
fragile.

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

Add fixture coverage for:

- `service-worker.js` detection anywhere in `src` and output at `/service-worker.js`.
- `service-worker.ts` detection when TypeScript is enabled.
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
