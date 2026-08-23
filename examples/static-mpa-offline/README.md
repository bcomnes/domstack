# Static MPA Offline Example

This example shows a small static multi-page app that can load selected static assets offline with a production-oriented service-worker lifecycle.

- Domstack emits a stable root `/service-worker.js`.
- `src/globals/domstack-manifest/domstack-manifest.settings.ts` uses `hooks.manifestBuilt` to inject finalized manifest data into `/service-worker.js`.
- The service worker consumes the injected Domstack manifest entries directly.
- Selected pages, scripts, styles, chunks, and small static assets are precached.
- Layout vars define section-wide offline policy, and page vars or frontmatter can override that policy through domstack's normal variable cascade.
- The client prompts before activating an update discovered during an active session.
- Watch mode unregisters service workers and clears this example's caches to avoid half-cached development state.
- `?reset-sw` and `rescue-service-worker.js` are included as recovery paths.

## Running

```sh
npm --workspace @domstack/static-mpa-offline-example run serve
```

Then open the served localhost URL, wait for the offline cache to be ready, and use DevTools to test offline reloads.

Use watch mode only for editing:

```sh
npm --workspace @domstack/static-mpa-offline-example run watch
```

Watch mode does not inject production manifest policy into the service worker, so the watch worker unregisters itself and clears owned caches.
Use `serve` for offline-cache testing.

## Pages in the sample app

- `/` — home page and test instructions.
- `/about/` — normal precached offline page.
- `/offline/` — offline fallback page.
- `/admin/` — admin page excluded from precache; offline reload should show `/offline/`.
- `/progressive-cache/assets/` — page excluded from install-time precache but cached after the first online visit.
- `/progressive-cache/assets/details/` — second progressive-cache page with its own image subresource.
- `/progressive-cache/override/` — progressive-cache layout section page that opts back into precache.
- `/cache-inspector/` — diagnostic page that asks the service worker for cache contents.

## Layout and page policy

This example uses two user-facing manifest vars:

```ts
manifestVars: ['offline', 'precache']
```

The root layout defaults to `offline: true` and `precache: true`.
The progressive-cache layout defaults to `offline: true` and `precache: false`.
The admin layout defaults to `offline: false` and `precache: false`.

The cascade is page → layout → global → default.
That means a layout can set a policy for a route section, and an individual page can still override that policy with `page.vars.ts` or frontmatter.

The manifest settings also define one app-level fallback route:

```ts
policy: {
  offlineFallbackUrl: '/offline/',
}
```

The service worker uses that fallback for failed offline navigations instead of carrying route-specific fallback rules.

## Progressive caching after first visit

The `/progressive-cache/assets/` pages use the `progressive-cache` layout vars.
Those pages are available offline only after a successful online visit.

To test it:

1. Load `/progressive-cache/assets/` and `/progressive-cache/assets/details/` while online.
2. Switch DevTools to offline.
3. Reload those pages.
4. Their HTML and SVG image subresources should be served from the runtime cache.

The `/progressive-cache/override/` page opts back into install-time precache from inside the progressive-cache section.

## Client and service-worker structure

The browser client and service worker are split by concern:

```txt
src/
  globals/
    global.css
    global.vars.ts
    global-client/
      global.client.ts                 # bootstrap, config, and dependency wiring
      connection-status.ts             # online/offline detection
      service-worker-events.ts         # push/sync/periodic sync messages
      service-worker-registration.ts   # registration, updates, reload flow
      service-worker-reset.ts          # reset query param and watch cleanup
      status-banner.ts                 # in-page status/indicator rendering
    domstack-manifest/
      domstack-manifest.settings.ts    # manifest vars, policy, include filter, and hook registration
      policy-build.ts                  # injects finalized manifest data into /service-worker.js
    service-worker/
      service-worker.ts                # event wiring entrypoint
      service-worker-settings.ts       # shared app settings and app-defined types
      background-events.ts             # push/sync/periodic sync demo handlers
      cache-inspection.ts              # cache-inspector message handling
      clients.ts                       # window client messaging helpers
      fetch-handlers.ts                # navigation and subresource fetch handling
      lifecycle.ts                     # install/activate/reset/watch cleanup
      precache.ts                      # manifest-entry-derived precache keys and cleanup
      runtime-cache.ts                 # first-visit runtime caching
```

`global-client/global.client.ts` owns the example-specific browser wiring and creates the status banner.
The service-worker modules receive the config and policy they need as arguments.
This keeps lifecycle, connectivity state, recovery, fetch handling, and UI rendering separate enough to reuse or replace independently.

## Push, sync, and periodic sync hooks

`src/globals/service-worker/service-worker.ts` includes conservative handlers for:

- `push`
- one-off Background Sync: `sync`
- Periodic Background Sync: `periodicsync`

These handlers are extension points only.
They do not request notification permission, subscribe users to push, register sync jobs, or cache app data.
When triggered from DevTools, they post messages to open windows so the example can display/log that the service-worker event fired.
Push events show a notification only if the user has already granted notification permission.

Full push/sync support is app-specific and usually also requires server-side push subscription storage, permission UX, retry policy, and privacy/security review.

## Recovery paths

For recoverable mistakes where pages still load, visit:

```txt
/?reset-sw
```

The client unregisters service workers, deletes this example's offline caches, removes the query parameter, and reloads.

For a truly bad service worker that breaks page loads, deploy `rescue-service-worker.js` at the exact production service-worker URL:

```txt
/service-worker.js
```

This mirrors Workbox's recommended no-op recovery worker: same URL, immediate `skipWaiting()`, no `fetch` handler, and cache cleanup.

## Research references

If you are revisiting this example in a fresh context window, these are the docs and source files that informed the implementation.

### Core docs

- <https://web.dev/learn/pwa/workbox>
- <https://developer.chrome.com/docs/workbox/>
- <https://developer.chrome.com/docs/workbox/service-worker-lifecycle>
- <https://developer.chrome.com/docs/workbox/service-worker-deployment>
- <https://developer.chrome.com/docs/workbox/handling-service-worker-updates>
- <https://developer.chrome.com/docs/workbox/precaching-dos-and-donts>
- <https://developer.chrome.com/docs/workbox/remove-buggy-service-workers>
- <https://developer.chrome.com/docs/workbox/modules/workbox-precaching>
- <https://developer.chrome.com/docs/workbox/modules/workbox-strategies>
- <https://developer.chrome.com/docs/workbox/modules/workbox-window>
- <https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API>
- <https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers>

### Local context

- `README.md` at the repo root — domstack manifest and first-class service-worker docs.
- `examples/static-mpa-offline/DESIGN.md` — design notes and rationale for this example.
- `examples/static-mpa-workbox-offline/README.md` — the same app structure implemented with Workbox caching APIs.
- `plans/domstack-manifest.md` — manifest hook and service-worker integration plan.
- `plans/standard-static-mpa-service-worker.md` — standard static MPA service-worker plan.
- `plans/workbox-workflow-integration.md` — implemented Workbox policy injection workflow.
