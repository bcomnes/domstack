# Static MPA Workbox Offline Example 

This example shows the same domstack static MPA offline policy model as `examples/static-mpa-offline`, but uses Workbox for the service-worker caching runtime.

Key points:

- Domstack emits a stable `/service-worker.js`.
- The service worker is authored with normal Workbox calls such as `precacheAndRoute(precacheManifest)`.
- `src/globals/domstack-manifest/domstack-manifest.settings.ts` uses `hooks.manifestBuilt` to inject a precomputed Workbox policy constant into `/service-worker.js`.
- Layout vars define section-wide offline policy:
  - `root.layout.ts`: `offline: true`, `precache: true`
  - `progressive-cache.layout.ts`: `offline: true`, `precache: false`
  - `admin.layout.ts`: `offline: false`, `precache: false`
- Page vars/frontmatter can override layout vars through domstack's normal cascade.
- Watch mode unregisters the worker and clears Workbox-owned caches to avoid stale dev state.
- `?reset-sw` and `rescue-service-worker.js` are included as recovery paths.

## Running

```sh
npm --workspace @domstack/static-mpa-workbox-offline-example run serve
```

Then open the served localhost URL, wait for the offline cache to be ready, and use DevTools to test offline reloads.

Use watch mode only for editing:

```sh
npm --workspace @domstack/static-mpa-workbox-offline-example run watch
```

Watch mode does not inject production manifest policy into the service worker, so this example disables and unregisters service workers while watching.
Use `serve` for offline-cache testing.

## What this example proves

This example uses the new manifest features together:

- `role` marks navigations, subresources, workers, and metadata.
- `static` filters cacheable build outputs.
- `urlRevisioned` lets hashed outputs use Workbox `revision: null`.
- `integrity` is passed through to Workbox precache entries.
- `manifestVars` carries resolved page/layout policy vars to each entry.
- root `policy` carries the app-level offline fallback route.
- `hooks.manifestBuilt` injects Workbox-shaped generated data after the final manifest exists.

## Workbox policy injection flow

The manifest built hook computes policy from the finalized Domstack manifest and injects it into the final service-worker bundle:

```ts
context.defineServiceWorkerConstant('__DOMSTACK_WORKBOX_POLICY__', {
  precacheManifest: [
    { url: '/', revision: '...' },
  ],
  runtimeUrls: ['/progressive-cache/assets/'],
  networkOnlyUrls: ['/admin/'],
  offlineFallbackUrl: '/offline/',
})
```

The authored service worker reads the injected constant, then passes the Workbox-native `precacheManifest` array directly to Workbox:

```ts
const policy = __DOMSTACK_WORKBOX_POLICY__
precacheAndRoute(policy.precacheManifest)
```

This keeps Workbox data generated from domstack's final manifest without Workbox globbing, `self.__WB_MANIFEST`, `importScripts()`, top-level await, or a runtime policy fetch.

## Pages in the sample app

- `/` — home page and test instructions.
- `/about/` — normal precached offline page.
- `/offline/` — offline fallback page.
- `/admin/` — admin page excluded from precache; offline reload should show `/offline/`.
- `/progressive-cache/assets/` — page excluded from install-time precache but cached after the first online visit by Workbox `NetworkFirst`.
- `/progressive-cache/assets/details/` — second progressive-cache page with its own image subresource.
- `/progressive-cache/override/` — progressive-cache layout section page that opts back into precache.
- `/cache-inspector/` — diagnostic page that asks the service worker for cache contents.

## Recovery paths

For recoverable mistakes where pages still load, visit:

```txt
/?reset-sw
```

For a truly bad service worker that breaks page loads, deploy `rescue-service-worker.js` at the exact production service-worker URL:

```txt
/service-worker.js
```

## Research references

- <https://web.dev/learn/pwa/workbox>
- <https://developer.chrome.com/docs/workbox/>
- <https://developer.chrome.com/docs/workbox/modules/workbox-precaching>
- <https://developer.chrome.com/docs/workbox/modules/workbox-routing>
- <https://developer.chrome.com/docs/workbox/modules/workbox-strategies>
- <https://developer.chrome.com/docs/workbox/modules/workbox-build>
- <https://developer.chrome.com/docs/workbox/handling-service-worker-updates>
- <https://developer.chrome.com/docs/workbox/remove-buggy-service-workers>
- <https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API>
- `plans/workbox-workflow-integration.md`
- `examples/static-mpa-offline/README.md`
