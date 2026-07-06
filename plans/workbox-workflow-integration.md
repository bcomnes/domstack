# Workbox Workflow Integration Plan

## Status: Example implemented with injected policy

`examples/static-mpa-workbox-offline` demonstrates the current preferred Workbox integration model.

Domstack does not run Workbox `injectManifest` and does not generate a JavaScript global loaded with `importScripts()`.

Instead, `hooks.manifestBuilt` computes a Workbox-oriented policy from the finalized Domstack manifest and injects it into the final `/service-worker.js` bundle with `context.defineServiceWorkerConstant()`.

The authored service worker remains normal user code.

It imports Workbox packages directly and passes the generated `precacheManifest` field to Workbox APIs.

## Goals

- Support Workbox without forcing it into domstack core.
- Generate correct Workbox precache data from Domstack's real emitted outputs.
- Keep user-authored service-worker code inspectable and customizable.
- Use Workbox for mature precaching, routing, strategies, plugins, and update helpers.
- Avoid runtime policy fetches and generated global scripts.
- Keep watch mode safe when no manifest policy exists.

## Non-goals

- Do not make service workers automatic for every domstack build.
- Do not require Workbox as a core dependency for sites that do not opt into it.
- Do not cache API/data endpoints by default.
- Do not hide service-worker stickiness or recovery requirements.
- Do not replace custom user-authored service workers.

## Current example architecture

The Workbox example uses:

- `src/globals/domstack-manifest/domstack-manifest.settings.ts`
- `src/globals/domstack-manifest/policy-build.ts`
- `src/globals/service-worker/service-worker.ts`
- `src/globals/global-client/*`

The manifest settings hook injects a policy constant:

```ts
context.defineServiceWorkerConstant('__DOMSTACK_WORKBOX_POLICY__', {
  version: manifest.version,
  offlineFallbackUrl: '/offline/',
  precacheManifest: [
    { url: '/', revision: 'sha256hex...' },
    { url: '/about/', revision: 'sha256hex...' },
    { url: '/global-ABC123.css', revision: null, integrity: 'sha256-...' },
  ],
  runtimeUrls: ['/progressive-cache/'],
  networkOnlyUrls: ['/admin/'],
})
```

The service worker reads the injected policy inside the manifest-enabled branch:

```ts
declare const __DOMSTACK_WORKBOX_POLICY__: StaticMpaWorkboxServiceWorkerPolicy

if (manifestEnabled) {
  const policy = __DOMSTACK_WORKBOX_POLICY__
  precacheAndRoute(policy.precacheManifest)
}
```

The policy constant must not be read at module top level in watch mode.

Watch mode builds do not define it.

## Workbox APIs currently used

The example uses:

- `workbox-precaching`
  - `precacheAndRoute()`
  - `cleanupOutdatedCaches()`
  - `matchPrecache()` where needed by fallback behavior
- `workbox-routing`
  - `registerRoute()`
  - `setCatchHandler()`
- `workbox-strategies`
  - `NetworkFirst`
  - `NetworkOnly`
- `workbox-cacheable-response`
  - `CacheableResponsePlugin`
- `workbox-expiration`
  - `ExpirationPlugin`
- `workbox-recipes`
  - `offlineFallback()`
- `workbox-window`
  - registration lifecycle events
  - `messageSkipWaiting()`

## Policy shape

Workbox's native precache input is:

```ts
type WorkboxPrecacheEntry = {
  url: string
  revision: string | null
  integrity?: string
}
```

The example policy includes that native shape plus app-specific route policy:

```ts
type StaticMpaWorkboxServiceWorkerPolicy = {
  version: string
  offlineFallbackUrl: string
  precacheManifest: WorkboxPrecacheEntry[]
  runtimeUrls: string[]
  networkOnlyUrls: string[]
}
```

Only `precacheManifest` is passed directly to Workbox precaching.

`runtimeUrls`, `networkOnlyUrls`, and `offlineFallbackUrl` are app policy and are mapped explicitly to Workbox routing/strategy APIs.

## Why injected policy is preferred

Injected policy has these advantages:

- no runtime fetch for a policy JSON file
- no generated JS file imported by the service worker
- no `importScripts()` convention
- no Workbox `self.__WB_MANIFEST` source transform
- policy changes alter `/service-worker.js` bytes
- browser update lifecycle is triggered naturally
- the authored service worker remains regular bundled module code

This means Domstack only needs the general `manifestBuilt` hook and final service-worker build step.

It does not need Workbox-specific source transformation in core.

## Watch mode

Workbox precaching is disabled in watch mode.

Watch mode sets `DOMSTACK_MANIFEST_ENABLED=false` and does not run the manifest/policy injection path.

The service worker branch for watch mode:

- installs immediately
- deletes owned caches
- unregisters itself
- registers no Workbox routes
- does not touch the injected policy constant

The client also unregisters existing workers and clears known caches in watch mode.

Watch builds disable esbuild splitting so `/service-worker.js` stays self-contained during cleanup.

## Client lifecycle

The Workbox example uses `workbox-window` because it provides cleaner lifecycle events than hand-rolled registration logic.

Current behavior:

- `installing` shows “Installing offline cache…”
- `activated` shows ready state for first install
- `waiting` prompts for update or applies a previously waiting update
- `controlling` reloads after accepted updates
- `redundant` logs to the console only

Watch-mode cleanup happens before normal registration and does not wait for `window.load`.

Production registration waits for `window.load`.

## Runtime caching policy

The example only runtime-caches routes selected by manifest vars.

It uses Workbox plugins to keep runtime cache behavior bounded:

- `CacheableResponsePlugin` limits which responses can enter the cache.
- `ExpirationPlugin` limits cache age/count.

The example does not cache arbitrary API/data requests by default.

## Potential package helper

A future helper could live outside core or as an optional export:

```ts
import { createWorkboxPolicy } from '@domstack/static/workbox'

export default {
  hooks: {
    manifestBuilt: [context => {
      context.defineServiceWorkerConstant(
        '__APP_WORKBOX_POLICY__',
        createWorkboxPolicy(context.manifest, options),
      )
    }],
  },
}
```

The helper could cover:

- max precache size
- include/exclude filters
- revision/null handling for hashed URLs
- optional integrity inclusion
- route-policy derivation from selected `manifestVars`
- warnings for skipped entries

This should remain optional.

Domstack core should continue exposing generic manifest hooks rather than hard-coding Workbox behavior.

## Deprecated ideas

These ideas were considered but are not the current direction:

- generating a public Workbox manifest module and importing it from the service worker
- fetching a policy JSON file during service-worker install
- using `importScripts()` to load generated globals
- transforming `self.__WB_MANIFEST` like Workbox `injectManifest`
- generating the entire Workbox service worker from core config

They remain possible for external integrations, but the example and current plan prefer injected constants.
