# DOMStack Workbox PWA Example

This example shows a static PWA that uses Domstack's unstable preview `domstack-manifest.json` output as the source of truth for a Workbox precache.

> [!WARNING]
> The domstack manifest and first-class service-worker support shown here are unstable preview features.
> The option names, manifest schema, generated outputs, and browser defines may change outside of a major version while the API is validated.
> Pin `@domstack/static` to an exact version before building long-lived integrations on this preview contract.

It demonstrates:

- A `service-worker.js` source that Domstack bundles to `/service-worker.js`.
- Workbox `precacheAndRoute(self.__WB_MANIFEST)`, `NavigationRoute`, and `PrecacheFallbackPlugin` using Domstack manifest entries injected at build time.
- A `settings/domstack-manifest.settings.js` file that filters the generated domstack manifest.
- Shared PWA policy in `settings/cache-policy.js`.
- Domstack browser defines isolated in `globals/domstack.js`.
- Domstack global assets grouped in `globals/global.client.js`, `globals/global.css`, and `globals/global.vars.js`.
- Offline precaching for app, docs, legal-style pages, static assets, shared chunks, and the web app manifest.
- Excluding `/blog/**`, `/admin/**`, source maps, metadata files, and pages with `precache: false` or `offline: false`.

## Running

```bash
npm install
npm --workspace @domstack/workbox-pwa-example run serve
```

The example serves on <http://localhost:3001> by default so it can run alongside the hand-rolled PWA example on port 3000.

Service workers require a secure origin. `localhost` is allowed by browsers, and `npm run serve` runs a manifest-enabled build so the Workbox precache path works there. It also serves without live-reload HTML injection so fetched files match the domstack manifest revisions.

Wait until the UI says `Offline cache current` before testing an offline refresh. To clear all example workers and caches:

```txt
/?reset-sw=1
```

## Files

```txt
scripts/
  inject-domstack-manifest.js     # Converts Domstack manifest entries into self.__WB_MANIFEST
  serve.js                        # Serves the already-built public/ directory on port 3001
src/
  globals/
    domstack.js                     # Browser defines injected by Domstack
    global.client.js                # Registers the Workbox-powered service worker
    global.css                      # Site styles
    global.vars.js                  # Shared page variables
  settings/
    cache-policy.js                 # Shared domstack manifest filtering and route policy
    domstack-manifest.settings.js   # Filters the written domstack manifest
  manifest.webmanifest              # Web app manifest copied as a static asset
  service-worker.js                 # Workbox-powered site service worker entry
```

## Production Pattern

This example follows Workbox's `injectManifest`-style runtime pattern:

```js
precacheAndRoute(self.__WB_MANIFEST)
```

Domstack emits `public/domstack-manifest.json` with `{ url, revision }` records. After Domstack builds and bundles `src/service-worker.js`, `scripts/inject-domstack-manifest.js` converts the emitted Domstack manifest entries into Workbox precache entries and replaces the `self.__WB_MANIFEST` placeholder in `public/service-worker.js`.

Application policy stays in app code:

- `settings/domstack-manifest.settings.js` decides what can ever enter the manifest.
- `settings/cache-policy.js` centralizes manifest filtering and the offline fallback URL.
- `service-worker.js` uses Workbox's documented precache route plus a network-only navigation route with a precached offline fallback.
- `globals/global.client.js` decides when to register, reset, and report cache status.

Watch mode does not write the domstack manifest or run the injection step, so use `npm run serve` when testing the offline lifecycle.
