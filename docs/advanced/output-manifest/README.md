---
layout: docs
docsOrder: 129
docsParent: /docs/advanced/
handlebars: false
---

# Output manifest

The DOMStack manifest is build metadata for service workers, deployment tools, and other build-time integrations.
It is not a [Web App Manifest](../../workers/#registration-and-web-app-manifests).
A Web App Manifest such as `site.webmanifest` can be generated independently with a [template](../../generation/#templates).

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

## Enable the manifest

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
See [Supported file types](../../typescript/#supported-file-types) for all available extensions.


## Configure entries and policy

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

## Manifest built hooks

`hooks.manifestBuilt` runs after entries, policy, and version are finalized but before `/service-worker.js` is bundled.
Each hook receives:

- `manifest`: The finalized manifest
- `dest`: The absolute destination directory
- `defineServiceWorkerConstant(name, value)`: Injects a JSON-serializable value into only the final service-worker bundle
- `writeFile(outputRelname, contents)`: Writes an additional file under `dest`

Files written by a hook are not added back to the already-finalized manifest.
Prefer an injected constant when only the service worker needs the generated data.

## Service worker integration

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

## Programmatic configuration

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
