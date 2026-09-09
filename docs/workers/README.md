---
layout: docs
handlebars: false
---

# Workers

Use page-scoped web workers to move work off the browser's main thread, and a site service worker to control requests and caching.
The DOMStack manifest provides an inventory of built files for service-worker policies and other tooling.

## Table of Contents

[[toc]]

## Web workers

You can easily write [web workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) for a page by adding a file called `${name}.worker.ts` or `${name}.worker.js` where `name` becomes the name of the worker filename in the `workers.json` file.
DOMStack will build these similarly to page `client.ts` bundles, and will even bundle split their contents with the rest of your site.

```
page-directory/
  ├── page.js
  ├── client.js
  ├── counter.worker.js  # Worker with counter functionality
  └── data.worker.js     # Worker for data processing
```

To use a woker, load in a `./workers.json` file that is generated along with the worker bundle to get the final name of the worker entrypoint and then create a worker with that filename.

```typescript
// First, fetch the workers.json to get worker paths in your client.ts
async function initializeWorkers() {
  const response = await fetch('./workers.json');
  const workersData = await response.json();

  // Initialize workers with the correct hashed filenames
  const counterWorker = new Worker(
    new URL(`./${workersData.counter}`, import.meta.url),
    { type: 'module' }
  );

  // Use the worker
  counterWorker.postMessage({ action: 'increment' });

  counterWorker.onmessage = (e) => {
    console.log(e.data);
  };

  return counterWorker;
}

const worker = await initializeWorkers();
```

See the [Web Workers Example](https://github.com/bcomnes/domstack/tree/master/examples/worker-example) for a complete implementation.

## Service workers

DOMStack has full native support for [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API).
Put one site service worker source file anywhere under `src` and domstack will build it to a stable
root `/service-worker.js` output:

```txt
src/
└── globals/
    └── service-worker.ts
```

DOMStack produces:

```txt
public/
└── service-worker.js
```

> [!NOTE]
> Wherever `service-worker.ts` is used, you can also use `service-worker.js`.
Type checking is supported in both file types.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions.

Only one site service worker source is allowed.
If multiple `service-worker.*` sources are present,
domstack fails with `DOM_STACK_ERROR_DUPLICATE_SERVICE_WORKER`.
Service workers are bundled using the project’s [`esbuild.settings.ts`](../settings/#esbuild.settings.ts) configuration, so imports work the same way they do for client bundles and page-scoped web workers.
The
entry filename is intentionally not content-hashed because browser service-worker update checks need
a stable URL.

DOMStack provides the service-worker URL and scope to browser bundles through esbuild `define` values:

| Define | Value |
| --- | --- |
| `process.env.DOMSTACK_SERVICE_WORKER_URL` | Public URL of the site service worker, usually `/service-worker.js`, or `""` when no service worker is present |
| `process.env.DOMSTACK_SERVICE_WORKER_SCOPE` | Registration scope for the site service worker, usually `/`, or `""` when no service worker is present |

Register the built service worker from your site client code, usually `global.client.ts`:

```typescript
// src/globals/global.client.ts
const serviceWorkerUrl = process.env.DOMSTACK_SERVICE_WORKER_URL
const serviceWorkerScope = process.env.DOMSTACK_SERVICE_WORKER_SCOPE

if (serviceWorkerUrl && serviceWorkerScope && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(serviceWorkerUrl, {
    scope: serviceWorkerScope,
    type: 'module',
    updateViaCache: 'none'
  })
}
```

DOMStack does not inject this into the default layout.
Registration timing, update prompts, development opt-outs, and recovery behavior are application policy, so keep that logic in your global client or an imported client module.

### Registration and Web App Manifests

Browsers allow service-worker registration only in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), normally HTTPS in production or localhost during development.
The service-worker script must be served from the same origin as the page.
DOMStack emits it at the origin root so its default scope can cover the entire site.
Register it with `type: 'module'` because DOMStack builds the worker as ESM.

A [Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest) is not required to register or run a service worker.
Add one when the site also needs installable-app metadata such as its name, icons, start URL, display mode, and theme colors.
DOMStack does not generate this browser manifest.
Author it as a [static asset](../../docs/assets/#static-assets) and reference it from the document head:

```html
<!-- HTML generated by src/layouts/root.layout.ts -->
<link rel="manifest" href="/site.webmanifest">
```

See these complete examples:

- [`static-mpa-offline`](https://github.com/bcomnes/domstack/tree/master/examples/static-mpa-offline/) uses DOMStack's manifest hooks with a custom service worker and registration lifecycle.
- [`static-mpa-workbox-offline`](https://github.com/bcomnes/domstack/tree/master/examples/static-mpa-workbox-offline/) implements the same offline MPA pattern with Workbox.

> [!CAUTION]
> DOMStack does not clean `dest` before building.
Clean the destination before deployment, especially after removing or renaming a service worker, so an old `/service-worker.js` cannot remain publicly available.

## DOMStack manifest

The DOMStack manifest is build metadata for service workers, deployment tools, and other build-time integrations.
It is not a [Web App Manifest](../../docs/workers/#registration-and-web-app-manifests).
A Web App Manifest such as `site.webmanifest` can be generated independently with a [template](../generation/#templates).

A generated manifest resembles:

```jsonc
// public/domstack-manifest.json
{
  "$schema": "https://unpkg.com/@domstack/static@<version>/lib/domstack-manifest/schema.json",
  "version": "a1b2c3...",
  "generatedAt": "2026-08-31T12:00:00.000Z",
  "entries": [
    {
      "outputRelname": "index.html",
      "kind": "page",
      "url": "/",
      "revision": "d4e5f6...",
      "bytes": 1240,
      "contentType": "text/html; charset=utf-8",
      "static": true,
      "role": "navigation"
    }
  ],
  "policy": {
    "offlineFallbackUrl": "/offline/"
  }
}
```

When enabled, DOMStack collects its emitted pages, templates, bundles, workers, copied files, and static assets into a normalized list of public outputs.
You can filter that list, expose selected page variables, attach application policy, and consume the finalized result from a hook or programmatic build.
The finalized manifest can be injected statically into your service worker or emitted as a standalone `domstack-manifest.json` file.

> [!WARNING]
> The DOMStack manifest pipeline is an unstable preview feature.
This includes its schema, settings, hooks, policy and entry variables, and `process.env.DOMSTACK_MANIFEST_*` defines.
Pin `@domstack/static` to an exact version when building against this preview API.

The manifest lifecycle is:

1.
  DOMStack collects and reconciles emitted outputs.
2.
  Excludes and entry filters run, then selected page variables are attached.
3.
  DOMStack finalizes the manifest entries, root policy, and deterministic version.
4.
  `manifestBuilt` hooks receive the finalized manifest.
5.
  DOMStack bundles the site service worker with any constants defined by the hooks.
6.
  DOMStack optionally writes `domstack-manifest.json` and returns the manifest from programmatic builds.

The site service worker is omitted from manifest entries.
This allows the finalized manifest version to be embedded in `/service-worker.js` without creating a circular content hash.

### Enable the manifest

The manifest pipeline is disabled by default.
Enable it with one of these configuration surfaces:

| Configuration | Pipeline enabled | Writes `domstack-manifest.json` |
|---|---:|---:|
| One `domstack-manifest.settings.ts` file anywhere in `src` | Yes | No |
| `domstackManifest: true` | Yes | Yes |
| `domstackManifest: { ... }` | Yes | Only with `write: true` |
| CLI `--domstackManifest` | Yes | Yes |

A settings file enables manifest reconciliation, hooks, and `results.domstackManifest` without requiring a public JSON file.
This is sufficient when a service worker receives its cache policy through an injected build constant.

> [!NOTE]
> Wherever `domstack-manifest.settings.ts` is used, you can also use `domstack-manifest.settings.js`.
Type checking is supported in both file types.
See [Supported file types](../../docs/typescript/#supported-file-types) for all available extensions.


### Configure entries and policy

Create one `domstack-manifest.settings.ts` file anywhere under `src`.
It can default-export an options object or a synchronous or asynchronous function that returns one.

```typescript
// src/globals/domstack-manifest.settings.ts
import type { DomstackManifestOptions } from '@domstack/static/types.js'

type PageVars = {
  offline?: boolean
  precache?: boolean
}

type ManifestVars = Pick<PageVars, 'offline' | 'precache'>

type ManifestPolicy = {
  offlineFallbackUrl: string
}

const settings = {
  exclude: ['admin/**', '**/*.map'],
  includeEntry: entry => entry.kind !== 'metadata',
  manifestVars: ['offline', 'precache'],
  policy: {
    offlineFallbackUrl: '/offline/'
  }
} satisfies DomstackManifestOptions<
  ManifestPolicy,
  ManifestVars,
  PageVars
>

export default settings
```

The main settings are:

| Setting | Purpose |
|---|---|
| `exclude` | Ignore-style patterns matched against both `entry.url` and `entry.outputRelname` |
| `includeEntry(entry)` | A final synchronous or asynchronous predicate that returns `true` to retain an entry |
| `manifestVars` | An allowlist or per-entry transform that exposes selected resolved page variables |
| `policy` | A manifest-wide object or transform for application-defined policy |
| `hooks.manifestBuilt` | Hooks that consume the finalized manifest before the service worker is bundled |

Only variables explicitly selected by `manifestVars` are copied into entries.
Arbitrary page variables are not exposed automatically.
`exclude` runs before `includeEntry(entry)`.

The resulting manifest contains:

- `version`: A deterministic digest that changes when retained cache-relevant entries or root policy change
- `generatedAt`: The build timestamp, which does not affect `version`
- `entries`: Included public outputs sorted by URL
- `policy`: Optional application-defined manifest-wide policy

Useful entry fields include `url`, `revision`, `kind`, `bytes`, `contentType`, `integrity`, `urlRevisioned`, `static`, `role`, and explicitly selected `manifestVars`.
Import `DomstackManifest` and `DomstackManifestEntry` from `@domstack/static/types.js` when consuming these objects directly.

### Manifest built hooks

`hooks.manifestBuilt` runs after entries, policy, and version are finalized but before `/service-worker.js` is bundled.
Each hook receives:

- `manifest`: The finalized manifest
- `dest`: The absolute destination directory
- `defineServiceWorkerConstant(name, value)`: Injects a JSON-serializable value into only the final service-worker bundle
- `writeFile(outputRelname, contents)`: Writes an additional file under `dest`

Files written by a hook are not added back to the already-finalized manifest.
Prefer an injected constant when only the service worker needs the generated data.

### Service worker integration

A manifest hook can turn the normalized entries into a small application-specific cache policy:

```typescript
// src/globals/domstack-manifest.settings.ts
import type {
  DomstackManifestBuiltHookContext,
  DomstackManifestOptions
} from '@domstack/static/types.js'

export type CachePolicy = {
  version: string
  precacheEntries: Array<{
    url: string
    revision: string | null
    integrity?: string
  }>
}

function injectCachePolicy (
  context: DomstackManifestBuiltHookContext
): void {
  const policy: CachePolicy = {
    version: context.manifest.version,
    precacheEntries: context.manifest.entries
      .filter(entry => entry.static === true)
      .filter(entry => entry.revision)
      .map(entry => ({
        url: entry.url,
        revision: entry.urlRevisioned ? null : entry.revision,
        ...(entry.integrity ? { integrity: entry.integrity } : {})
      }))
  }

  context.defineServiceWorkerConstant('__APP_CACHE_POLICY__', policy)
}

const settings = {
  hooks: {
    manifestBuilt: [injectCachePolicy]
  }
} satisfies DomstackManifestOptions

export default settings
```

The service worker can then consume the injected value without fetching a public manifest at runtime:

```typescript
// src/globals/service-worker.ts
import type { CachePolicy } from './domstack-manifest.settings.ts'

declare const __APP_CACHE_POLICY__: CachePolicy

const cachePolicy = __APP_CACHE_POLICY__
```

Manifest-enabled builds also define:

| Define | Value |
|---|---|
| `process.env.DOMSTACK_MANIFEST_ENABLED` | `"true"` for a manifest-enabled one-shot build and `"false"` otherwise |
| `process.env.DOMSTACK_MANIFEST_VERSION` | The finalized version inside `/service-worker.js`; `""` in other bundles |
| `process.env.DOMSTACK_MANIFEST_URL` | The conventional `/domstack-manifest.json` URL |

`DOMSTACK_MANIFEST_URL` does not guarantee that the JSON file was written.
Fetch it only when `--domstackManifest`, `domstackManifest: true`, or `{ write: true }` enabled public output.

> [!IMPORTANT]
> Watch mode still bundles the service worker, but it does not finalize, return, or write the DOMStack manifest.
Manifest hooks do not inject production cache policy in watch mode.
Use a one-shot build or `domstack --serve` to test manifest-driven service-worker behavior.

`domstack --serve` runs a normal one-shot build and serves `dest` without watch-mode filenames or live-reload injection:

```console
domstack --serve
domstack --serve --port 3001
```

See the complete examples for production-oriented cache lifecycle behavior:

- [`static-mpa-offline`](https://github.com/bcomnes/domstack/tree/master/examples/static-mpa-offline/) injects DOMStack manifest entries into a custom service worker.
- [`static-mpa-workbox-offline`](https://github.com/bcomnes/domstack/tree/master/examples/static-mpa-workbox-offline/) converts the finalized entries into Workbox precaching and routing policy.

### Programmatic configuration

Configure the manifest through the `DomStack` constructor when coordinating it with another build tool or script:

```typescript
// scripts/build.ts
import { DomStack } from '@domstack/static'

const site = new DomStack('src', 'public', {
  domstackManifest: {
    write: true,
    exclude: ['admin/**', '**/*.map']
  }
})

const results = await site.build()
console.log(results.domstackManifest?.version)
```

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
