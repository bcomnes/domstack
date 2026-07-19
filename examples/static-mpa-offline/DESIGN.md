# Static MPA Offline Service Worker Design Notes

## Status

These notes describe the current vanilla offline service-worker example in `examples/static-mpa-offline`.

The example is intentionally small and does not use Workbox at runtime.
It still borrows Workbox's useful mental model: build a manifest from emitted files, precache revisioned assets during `install`, clean old cache entries during `activate`, and use a deliberate update UX.

## Current architecture

Domstack builds a stable root service worker at `/service-worker.js`.
The service worker is omitted from the Domstack manifest so its own output does not create a manifest/hash cycle.
After the final manifest is built, `hooks.manifestBuilt` injects the manifest-derived policy into the final service-worker bundle with `defineServiceWorkerConstant()`.

The service worker does not fetch `/domstack-manifest.json` at runtime.
The example also does not emit a separate service-worker policy JSON file.

The injected policy keeps the Domstack manifest entry shape:

```ts
type StaticMpaOfflineServiceWorkerPolicy = {
  version: string
  entries: DomstackManifestEntry<StaticMpaOfflineManifestVars>[]
  offlineFallbackUrl: string
}
```

That lets the worker derive cache behavior from the same fields the manifest already owns:

- `entry.url`
- `entry.revision`
- `entry.urlRevisioned`
- `entry.integrity`
- `entry.bytes`
- `entry.kind`
- `entry.role`
- `entry.static`
- `entry.manifestVars`

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

The worker uses that route for failed offline navigations.
It does not need per-route fallback target metadata.

## Cache model

The worker uses a stable precache cache name and revisioned cache keys.
Unhashed URLs get a `?__DOMSTACK_REVISION__=<revision>` cache key.
Hashed URLs can use their URL as the cache key because the URL already changes when contents change.

The worker uses a separate runtime cache for progressive-cache pages.
Pages with `offline: true` and `precache: false` are not install-cached.
They become available offline after their first successful online visit.

Chunks are precached in production builds so dynamic imports used by cached pages stay available offline.
Watch builds disable splitting so the watch-mode service worker remains self-contained.

## Watch mode

Watch mode is for editing, not offline testing.
A watch build does not inject the production policy constant.
When the watch worker sees that no policy was injected, it skips caching, unregisters itself, and clears this example's caches.
The browser client also unregisters existing workers and clears owned caches when running in watch mode.

Use `npm --workspace @domstack/static-mpa-offline-example run serve` for offline-cache testing.

## Update lifecycle

The service worker does not unconditionally call `skipWaiting()` in the production path.
The browser client detects waiting updates and shows an update prompt.
If the user accepts, the client sends `{ type: 'SKIP_WAITING' }` to the waiting worker.
The page reloads once after `controllerchange` so the page and service worker move to the same version together.

This avoids mixed-version pages where old HTML or JavaScript is controlled by a new cache manifest.

## Fetch behavior

The worker handles same-origin `GET` requests only.
Navigations first try the precache, then the runtime cache, then the network, then the offline fallback.
Static subresources first try the precache.
Progressive-cache subresources can be stored in the runtime cache after the requesting page is visited online.

Navigation preload may be enabled during activation, but cache wins are allowed to settle the preload promise with `event.waitUntil()` so browsers do not report abandoned preload work.

## Recovery paths

The example includes two recovery tiers.

For recoverable mistakes where page JavaScript still runs, `?reset-sw` unregisters service workers, deletes this example's caches, removes the query parameter, and reloads.
For severe mistakes, deploy `rescue-service-worker.js` at `/service-worker.js` to replace the broken worker with a no-op worker at the same registration URL.

Do not change the service-worker URL during recovery.
A no-op worker at a different URL leaves the broken registration active at the old URL.

## Deployment headers

Recommended production headers:

```txt
/service-worker.js
  Cache-Control: no-cache

/**/*.html
  Cache-Control: no-cache

/assets/content-hashed-files...
  Cache-Control: public, max-age=31536000, immutable
```

`no-cache` allows browser/storage revalidation.
It does not mean "never store".
Do not serve `/service-worker.js` with long-lived immutable caching.
Content-hashed CSS, JavaScript, and chunks can be immutable because their URL changes when contents change.
