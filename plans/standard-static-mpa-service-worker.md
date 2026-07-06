# Optional Standard Static MPA Service Worker

## Status: Proposal validated by example

`examples/static-mpa-offline` is the current domstack-native prototype for a possible optional standard static MPA service-worker preset.

It no longer runtime-fetches `domstack-manifest.json` or a generated policy JSON file.

Instead, `hooks.manifestBuilt` injects the finalized manifest-shaped policy into `/service-worker.js` with `defineServiceWorkerConstant()`.

The service worker consumes Domstack manifest entries directly and derives cache behavior from the manifest fields and selected offline vars.

## Goals

- Provide a simple, robust, production-ready static MPA offline preset.
- Keep service workers explicit opt-in.
- Avoid forcing Workbox on sites that only need static MPA offline behavior.
- Use Domstack's finalized build graph instead of hand-maintained asset lists.
- Keep watch mode safe by disabling caches and unregistering old workers.
- Include recovery paths from the start.

## Non-goals

- Do not auto-enable service workers for all domstack sites.
- Do not cache API/data endpoints by default.
- Do not implement app-specific offline mutations, background sync, push subscriptions, or data models.
- Do not force a domstack-provided update UI into user layouts.
- Do not replace Workbox for apps that need Workbox plugins and recipes.

## Current example behavior

The vanilla example has these moving parts:

- `src/globals/domstack-manifest/domstack-manifest.settings.ts` selects `offline` and `precache` manifest vars and registers the build hook.
- `src/globals/domstack-manifest/policy-build.ts` injects `{ version, entries, offlineFallbackUrl }` into `/service-worker.js`.
- `src/globals/service-worker/service-worker.ts` chooses production vs watch behavior by detecting whether the injected policy constant exists.
- `src/globals/service-worker/precache.ts` derives precache keys and runtime strategy from Domstack manifest entries.
- `src/globals/global-client/*` owns registration, update UI, watch cleanup, reset query params, and connection status.

The service worker uses:

- stable `/service-worker.js`
- stable cache names
- revisioned cache keys for non-hashed URLs
- cache-first handling for precached static outputs
- network-first handling for progressive/runtime routes
- network-only behavior for offline-disabled routes
- navigation fallback to the offline page
- watch-mode no-policy self-disable
- `SKIP_WAITING` and `RESET_SERVICE_WORKER` messages

## Offline vars convention

The example intentionally keeps user-facing vars small:

```ts
type StaticMpaOfflineManifestVars = {
  offline?: boolean
  precache?: boolean
}
```

`offline: true` means the page/route is allowed to become available offline.

`offline: false` makes the route network-only with offline fallback behavior for navigations.

`precache: true` means the navigation page is cached during install.

`precache: false` means the navigation page is runtime-cached after the first successful visit.

Layout vars set section defaults.

Page vars/frontmatter can override layout vars through the normal cascade.

The cascade is:

```txt
page vars -> layout vars -> global vars -> defaults
```

## Build-time injection model

The current build model is:

```txt
final Domstack manifest
  -> manifestBuilt hook
  -> context.defineServiceWorkerConstant('__DOMSTACK_SERVICE_WORKER_POLICY__', policy)
  -> final /service-worker.js bundle
```

This is preferred over:

- fetching `/domstack-manifest.json` at runtime
- fetching `/domstack-service-worker-policy.json` at runtime
- generating JavaScript globals with `importScripts()`
- using top-level await in service workers

Policy changes change `/service-worker.js` bytes and trigger the browser update lifecycle.

## Watch mode

Watch mode does not produce a manifest policy.

The service worker detects that the injected policy constant is missing and installs as a no-op cleanup worker.

The watch worker:

- calls `skipWaiting()` during install
- deletes owned caches during activation
- unregisters itself
- registers no fetch handler

The browser client also unregisters workers and clears known caches in watch mode.

This double layer matters because a previous production worker can serve cached HTML/JS before the watch-mode client code runs.

Watch builds disable esbuild splitting so `/service-worker.js` stays self-contained during cleanup.

## Client registration helper behavior

A future reusable client helper should:

1. No-op when `navigator.serviceWorker` is unavailable.
2. Clean up when `DOMSTACK_MANIFEST_ENABLED` is false.
3. Register after `window.load` by default.
4. Register with the stable service-worker URL/scope from Domstack defines.
5. Use `{ type: 'module', updateViaCache: 'none' }`.
6. Detect `installing`, `waiting`, and `active` states immediately after registration.
7. Expose callbacks/events for ready, update available, updating, reset, error, and online/offline state.
8. Avoid hard-coded blocking dialogs.
9. Provide a default reset query param such as `?reset-sw`.
10. Reload once on `controllerchange` after an accepted update.

## Possible reusable API

Start with reusable imports rather than generated service-worker source:

```ts
// src/service-worker.ts
import '@domstack/static/service-worker/static-mpa'
```

```ts
// src/global.client.ts
import { registerDomstackServiceWorker } from '@domstack/static/client/service-worker'

registerDomstackServiceWorker()
```

This keeps service workers inspectable and customizable.

A higher-level preset can come later if the helper API stabilizes.

## Recovery design

Every standard path should include two recovery tiers.

### Recoverable reset

If page JS still loads, a query param should reset worker state:

```txt
/?reset-sw
```

Behavior:

1. Post `RESET_SERVICE_WORKER` to active/waiting/installing workers.
2. Unregister matching registrations.
3. Delete known domstack cache prefixes.
4. Remove the reset query param.
5. Reload from the network.

### Emergency replacement worker

A rescue worker can be deployed at the exact production service-worker URL:

```txt
/service-worker.js
```

It should:

- call `skipWaiting()` during install
- have no `fetch` handler
- delete known domstack caches during activate
- reload or let clients reload after control changes

The exact URL requirement is important.

Deploying a rescue worker at a different URL leaves the broken worker active.

## Open questions

- Should domstack ship reusable static-MPA service-worker modules, or keep examples as copyable recipes?
- Should core expose helper utilities for deriving runtime strategy and precache keys from manifest entries?
- Should the public `domstack-manifest.json` schema remain a packaged artifact if service-worker use mostly relies on injected constants?
- How much default update UI should a helper provide versus only dispatching events?
