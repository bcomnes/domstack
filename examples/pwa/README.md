# DOMStack PWA Example

This example shows a production-style static PWA using Domstack's domstack manifest and first-class service-worker build support.

It demonstrates:

- A `service-worker.js` source that Domstack bundles to `/service-worker.js`.
- A `domstack-manifest.settings.js` file that filters the generated domstack manifest.
- A global client runtime that registers the worker, handles update prompts, and disables sticky caches during local watch development.
- Offline precaching for app, docs, legal-style pages, static assets, shared chunks, and the web app manifest.
- Excluding `/blog/**`, `/admin/**`, source maps, metadata files, and pages with `precache: false` or `offline: false`.
- Verbose console logging in the window runtime and service worker so the lifecycle is easy to inspect while learning or testing.

## Running

```bash
cd examples/pwa
npm install
npm run serve
```

Service workers require a secure origin. `localhost` is allowed by browsers, and `npm run serve`
runs a manifest-enabled build so the PWA path works there. Use `npm run watch` for development
without a sticky service worker cache. To clear all example workers and caches:

```txt
/?reset-sw=1
```

## Files

```txt
src/
  global.client.js          # Registers the service worker through pwa/runtime.js
  global.css                # Site styles
  global.vars.js            # Shared page variables
  domstack-manifest.settings.js      # Filters the written domstack manifest
  manifest.webmanifest      # Web app manifest copied as a static asset
  service-worker.js         # Site service worker entry
  pwa/
    cache-policy.js         # Shared domstack manifest filtering and constants
    runtime.js              # Browser registration/update/recovery behavior
  sw/
    *.js                    # Service-worker install, update, cache, and fetch helpers
```

## Production Pattern

The worker fetches `/domstack-manifest.json` during installation and uses the revisioned URLs in that file as its cache plan. The manifest is generated after Domstack reconciles pages, bundles, chunks, worker output, copied static assets, and templates. Application policy stays in app code:

- `domstack-manifest.settings.js` decides what can ever enter the manifest.
- `service-worker.js` decides how to install, activate, update, and serve cached responses.
- `global.client.js` decides when to register, prompt, apply updates, or recover from a bad cache.

Watch mode does not write the domstack manifest, so use `npm run serve` when testing the offline lifecycle.
