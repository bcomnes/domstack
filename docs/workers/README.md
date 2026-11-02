---
layout: docs
docsOrder: 110
handlebars: false
---

# Workers

Use page-scoped web workers to move work off the browser's main thread, and a site service worker to control requests and caching.
The DOMStack manifest provides an inventory of built files for service-worker policies and other tooling.

## Table of Contents

[[toc]]

## Web workers

You can write [dedicated workers](https://developer.mozilla.org/en-US/docs/Web/API/Worker) and [shared workers](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker) for a page by adding a file called `${name}.worker.ts` or `${name}.worker.js`, where `name` becomes the key for the worker filename in `workers.json`.
DOMStack builds both worker kinds as ESM entry points similarly to page `client.ts` bundles and can split shared dependencies into chunks with the rest of your site.

```
page-directory/
  ├── page.js
  ├── client.js
  ├── counter.worker.js  # Worker with counter functionality
  └── data.worker.js     # Worker for data processing
```

To use a worker, load the generated `./workers.json` file to get the content-hashed worker entrypoint filename and then create a `Worker` or `SharedWorker` with that filename.

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

### Shared workers

A shared worker uses the same generated mapping, but clients communicate through its `port` property.
All pages connecting to a shared worker must use the same origin and worker URL.

```typescript
const response = await fetch('./workers.json')
const workersData = await response.json()
const sharedWorker = new SharedWorker(
  new URL(`./${workersData['shared-counter']}`, import.meta.url),
  { type: 'module' }
)

sharedWorker.port.onmessage = event => {
  console.log(event.data)
}
sharedWorker.port.start()
sharedWorker.port.postMessage({ action: 'increment' })
```

Inside `shared-counter.worker.ts`, accept each connection and communicate through the supplied `MessagePort`.

```typescript
/// <reference lib="webworker" />

const sharedWorker = globalThis as unknown as SharedWorkerGlobalScope
let count = 0

sharedWorker.onconnect = event => {
  const port = event.ports[0]
  if (!port) return

  port.onmessage = message => {
    if (message.data.action === 'increment') count++
    port.postMessage({ count })
  }
  port.start()
  port.postMessage({ count })
}
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
See [Output manifest](../advanced/output-manifest/) for configuration, hooks, and service-worker integration.
