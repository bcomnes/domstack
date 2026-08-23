# Static MPA Offline Example

This small multi-page app demonstrates a production-oriented offline cache for static domstack output.

- `/service-worker.js` is stable and un-hashed.
- `/service-worker.js` receives finalized manifest data at build time.
- Normal static pages and assets can reload offline.
- Updates use an in-page prompt instead of a blocking dialog.
- Watch mode disables service workers so local edits do not get stuck behind stale caches.
- A bad service worker can be reset with `?reset-sw`.

## Try it

1. Run `npm run serve` in this example.
2. Wait for the banner to say the offline cache is ready.
3. Use DevTools to go offline.
4. Reload the cached pages below.

## Sample pages

- [About the offline cache](./about/) — default policy: `offline: true`, `precache: true`.
- [Offline fallback](./offline/) — fallback used when an uncached or network-only navigation fails offline.
- [Admin / network-only page](./admin/) — uses the `admin` layout policy: `offline: false`, `precache: false`.
- [Progressive cache assets](./progressive-cache/assets/) — uses the progressive-cache layout policy: `offline: true`, `precache: false`.
- [Progressive cache asset details](./progressive-cache/assets/details/) — second progressive-cache page with its own image subresource.
- [Progressive cache alpha](./progressive-cache/alpha/) — frontmatter selects the progressive-cache layout.
- [Progressive cache beta](./progressive-cache/beta/) — second frontmatter-driven progressive-cache page.
- [Progressive cache override](./progressive-cache/override/) — uses the progressive-cache layout, but overrides `precache: true` in `page.vars.ts`.
- [Cache inspector](./cache-inspector/) — asks the service worker for cache names and cached response details.

## Policy vars

The example intentionally uses small, user-facing vars:

```ts
export type StaticMpaOfflinePageVars = {
  offline?: boolean
  precache?: boolean
  layout?: 'root' | 'admin' | 'progressive-cache'
}
```

Layouts export policy defaults with `export const vars`. For example, `src/layouts/root.layout.ts` makes normal pages available offline immediately:

```ts
export const vars = {
  offline: true,
  precache: true,
}
```

`src/globals/domstack-manifest/domstack-manifest.settings.ts` selects the resolved `offline` and `precache` page variables for `entry.manifestVars`. The resolved variable cascade includes layout vars, page vars, and Markdown frontmatter.

`src/globals/domstack-manifest/policy-build.ts` injects the finalized manifest entries into `/service-worker.js`. The service worker consumes those entries directly and derives cache behavior from their resolved `manifestVars`.

## Layout policy examples

The example layouts export these policy defaults:

- `src/layouts/root.layout.ts`: `offline: true`, `precache: true`
- `src/layouts/admin.layout.ts`: `offline: false`, `precache: false`
- `src/layouts/progressive-cache.layout.ts`: `offline: true`, `precache: false`

A page can select a layout in Markdown frontmatter:

```md
---
title: Progressive cache alpha
layout: progressive-cache
---
```

A page can override a layout policy with `page.vars.ts`:

```ts
export default {
  precache: true,
}
```

## Runtime cache behavior

Pages with `offline: true` and `precache: false` are skipped during install-time precaching. When visited online, the service worker stores the successful navigation in the runtime cache. Same-route subresources inherit the requesting page's generated runtime policy through `request.referrer`, because domstack does not yet emit complete page → subresource `dependencies` metadata.

After visiting a runtime page online once, reload it offline to confirm it was learned at runtime.
