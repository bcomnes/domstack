# Static MPA Workbox Offline Design Notes

## Status

These notes describe the current Workbox offline example in `examples/static-mpa-workbox-offline`.

The example keeps authored service-worker code while using Domstack's finalized manifest to generate the Workbox data.
It does not use Workbox `injectManifest`, `self.__WB_MANIFEST`, `importScripts()`, or a runtime policy JSON fetch.

## Current architecture

Domstack builds a stable root service worker at `/service-worker.js`.
The service worker is omitted from the Domstack manifest so its own output does not create a manifest/hash cycle.
After the final manifest is built, `hooks.manifestBuilt` computes a Workbox-shaped policy and injects it into the final service-worker bundle with `defineServiceWorkerConstant()`.

The injected policy has one Workbox-native field and a few app-specific route fields:

```ts
type StaticMpaWorkboxServiceWorkerPolicy = {
  version: string
  precacheManifest: WorkboxPrecacheEntry[]
  runtimeUrls: string[]
  networkOnlyUrls: string[]
  offlineFallbackUrl: string
}
```

`precacheManifest` is passed directly to `precacheAndRoute()`.
The other fields are used by the app's Workbox `registerRoute()` calls and `offlineFallback()` recipe.

## Manifest vars and policy

The app exposes two page/layout vars to the manifest:

```ts
manifestVars: ['offline', 'precache']
```

The variable cascade is page → layout → global → default.
Layout modules use this to define route-section defaults.
Page vars or frontmatter can override those defaults for a single page.

The root app policy carries the single offline fallback route:

```ts
policy: {
  offlineFallbackUrl: '/offline/',
}
```

## Workbox usage

The service worker uses these Workbox APIs:

- `precacheAndRoute()` for install-time precache.
- `cleanupOutdatedCaches()` for old Workbox precache cleanup.
- `offlineFallback()` for failed offline navigations.
- `NetworkFirst` for progressive-cache routes.
- `NetworkOnly` for network-only routes.
- `CacheableResponsePlugin` to limit runtime cache writes to configured response statuses.
- `ExpirationPlugin` to limit runtime cache age, entry count, and quota pressure.
- `workbox-window` in the browser client for registration and update events.

The example keeps Workbox's native precache shape:

```ts
type WorkboxPrecacheEntry = {
  url: string
  revision: string | null
  integrity?: string
}
```

Hashed URLs use `revision: null`.
Unhashed URLs use the Domstack `revision` value.
If Domstack emitted `integrity`, it is passed through to Workbox.

## Runtime routes

Pages with `offline: true` and `precache: false` become Workbox `NetworkFirst` runtime routes.
Their HTML and same-section subresources can become available offline after a successful online visit.

Pages with `offline: false` become navigation-only `NetworkOnly` routes.
Failed offline navigations fall through to the configured offline fallback.

Pages with `precache: true` and no runtime strategy are included in the Workbox precache when they are static, revisioned, and below the configured size limit.
Chunks are precached in production builds so dynamic imports used by cached pages stay available offline.

## Watch mode

Watch mode is for editing, not offline testing.
When `DOMSTACK_MANIFEST_ENABLED` is false, the worker installs as a cleanup worker, clears Workbox-owned caches, and does not register runtime caching routes.
The browser client also unregisters existing workers and clears owned caches while watching.

Use `npm --workspace @domstack/static-mpa-workbox-offline-example run serve` for offline-cache testing.

## Update lifecycle

The browser client uses `workbox-window` to register after load, detect waiting updates, and send `SKIP_WAITING` when the user accepts the update prompt.
The page reloads once when Workbox reports that the new worker is controlling the page.

Redundant worker transitions are logged to the console rather than shown as user-facing error states.

## Recovery paths

The example includes two recovery tiers.

For recoverable mistakes where page JavaScript still runs, `?reset-sw` unregisters service workers, deletes this example's caches, removes the query parameter, and reloads.
For severe mistakes, deploy `rescue-service-worker.js` at `/service-worker.js` to replace the broken worker with a no-op worker at the same registration URL.

Do not change the service-worker URL during recovery.
A no-op worker at a different URL leaves the broken registration active at the old URL.
