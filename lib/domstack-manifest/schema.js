/**
 * @import { DomStackWarning } from '../helpers/domstack-warning.js'
 * @import { FromSchema, JSONSchema } from 'json-schema-to-ts'
 */
import { readFileSync } from 'node:fs'

export const DEFAULT_DOMSTACK_MANIFEST_FILENAME = 'domstack-manifest.json'
export const DOMSTACK_MANIFEST_SCHEMA_PATH = 'lib/domstack-manifest/schema.json'
// The published JSON schema URL is major-versioned so compatible releases share a
// stable schema URL while future major versions can publish a new contract.
export const DOMSTACK_MANIFEST_SCHEMA_ID = getDomstackManifestSchemaId(readPackageVersion())

// Manifest schema and public types

// These schema objects are the source of truth for both runtime manifest validation and
// the public TypeScript/JSDoc types derived below with json-schema-to-ts.
export const domstackManifestKindSchema = /** @satisfies {JSONSchema} */ (/** @type {const} */ ({
  description: 'Classifies the build pipeline step or artifact type that produced this output.',
  enum: [
    'page',
    'template',
    'script',
    'style',
    'chunk',
    'service-worker',
    'worker',
    'worker-manifest',
    'static',
    'copy',
    'sourcemap',
    'metadata',
  ],
}))

export const domstackManifestEntryPageMetaSchema = /** @satisfies {JSONSchema} */ (/** @type {const} */ ({
  description: 'Page-specific metadata recorded for manifest entries whose kind is "page".',
  type: 'object',
  properties: {
    path: {
      description: 'Source-relative page path used by domstack routing, without a leading slash.',
      type: 'string',
    },
    url: {
      description: 'Canonical public URL for the page, such as "/" or "/docs/".',
      type: 'string',
    },

  },
  required: ['path', 'url'],
  additionalProperties: false,
}))

export const domstackManifestEntrySchema = /** @satisfies {JSONSchema} */ (/** @type {const} */ ({
  description: 'One public output emitted by domstack and included in the reconciled domstack manifest.',
  type: 'object',
  properties: {
    outputRelname: {
      description: 'Destination-relative output path using POSIX separators, such as "index.html" or "chunks/js/chunk-ABC.js".',
      type: 'string',
    },
    kind: domstackManifestKindSchema,
    url: {
      description: 'Public same-origin URL for the output, normalized with a leading slash.',
      type: 'string',
    },
    revision: {
      description: 'SHA-256 hex digest of the output file contents. Null is reserved for outputs without a content revision.',
      type: ['string', 'null'],
    },
    bytes: {
      description: 'Output file size in bytes. Null is reserved for outputs whose size is unavailable.',
      type: ['integer', 'null'],
    },
    sourceRelname: {
      description: 'Source-relative path that produced this output when a direct source file is known.',
      type: 'string',
    },
    entryPoint: {
      description: 'esbuild entry point path for script, style, worker, and service-worker outputs when available.',
      type: 'string',
    },
    pagePath: {
      description: 'Source-relative page path associated with this output when the output belongs to a page.',
      type: 'string',
    },
    pageUrl: {
      description: 'Canonical public page URL associated with this output when the output belongs to a page.',
      type: 'string',
    },
    templatePath: {
      description: 'Source-relative template path associated with this output when the output was emitted by a template.',
      type: 'string',
    },
    contentType: {
      description: 'Best-known MIME type for the emitted output. This is a build-time value and may differ from deployment HTTP headers.',
      type: 'string',
    },
    integrity: {
      description: 'SRI-formatted SHA-256 digest derived from the same content hash as revision, such as "sha256-AbCd...".',
      type: 'string',
    },
    manifestVars: {
      description: 'Explicitly selected page/app variables exposed for general manifest consumers.',
      type: 'object',
      additionalProperties: {
        description: 'Application-defined manifest variable value copied from the resolved page variable cascade. Domstack records this value but does not interpret it.',
      },
    },
    urlRevisioned: {
      description: 'Whether the public URL already contains a content hash or equivalent revision token.',
      type: 'boolean',
    },
    static: {
      description: 'Whether this entry is part of domstack static browser-loadable output and can be considered by offline/cache/deploy tooling.',
      type: 'boolean',
    },
    role: {
      description: 'Normalized runtime purpose for the entry, such as "navigation", "subresource", "worker", or "metadata".',
      type: 'string',
    },
    page: domstackManifestEntryPageMetaSchema,
  },
  required: ['outputRelname', 'kind', 'url', 'revision', 'bytes'],
  additionalProperties: false,
}))

export const domstackManifestSchema = /** @satisfies {JSONSchema} */ (/** @type {const} */ ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: DOMSTACK_MANIFEST_SCHEMA_ID,
  title: 'Domstack manifest',
  description: 'A normalized, revisioned manifest of public files emitted by a domstack build.',
  type: 'object',
  properties: {
    $schema: {
      description: 'Versioned URL of the JSON Schema that describes this manifest.',
      const: DOMSTACK_MANIFEST_SCHEMA_ID,
    },
    version: {
      description: 'SHA-256 hex digest derived from the final cache-relevant manifest entries.',
      type: 'string',
    },
    generatedAt: {
      description: 'ISO 8601 timestamp for when domstack generated this manifest.',
      type: 'string',
      format: 'date-time',
    },
    entries: {
      description: 'Sorted public output entries included in the manifest after excludes and filters are applied.',
      type: 'array',
      items: domstackManifestEntrySchema,
    },
    policy: {
      description: 'Freeform application or integration policy for the whole manifest, exposed for service workers, deployment tools, or other consumers.',
      type: 'object',
      additionalProperties: {
        description: 'Application-defined manifest policy value. Domstack records this value once at the manifest root but does not interpret it.',
      },
    },
  },
  required: ['$schema', 'version', 'generatedAt', 'entries'],
  additionalProperties: false,
}))

/**
 * This helper is exported for release tooling and consumers that need to reconstruct
 * the versioned unpkg schema URL without duplicating domstack's package path.
 *
 * @param {string} version
 */
export function getDomstackManifestSchemaId (version) {
  const majorVersion = /^(\d+)\./.exec(version)?.[1]
  if (!majorVersion) throw new TypeError(`Invalid DOMStack package version: ${version}`)
  return `https://unpkg.com/@domstack/static@${majorVersion}/${DOMSTACK_MANIFEST_SCHEMA_PATH}`
}

/**
 * @typedef {FromSchema<typeof domstackManifestKindSchema>} DomstackManifestKind
 */

/**
 * @typedef {FromSchema<typeof domstackManifestEntryPageMetaSchema>} DomstackManifestEntryPageMeta
 */

/**
 * A build step writes these as it emits files. Reconciliation turns them into
 * revisioned manifest entries.
 *
 * @typedef {object} DomstackManifestRecord
 * @property {string} outputRelname - Destination-relative output path using POSIX separators.
 * @property {string} filepath - Absolute filesystem path for the emitted output.
 * @property {DomstackManifestKind} kind - Build artifact category for reconciliation and manifest consumers.
 * @property {string} [url] - Public same-origin URL for the output.
 * @property {string} [sourceRelname] - Source-relative path that produced the output when known.
 * @property {string} [entryPoint] - esbuild entry point path for bundled outputs when available.
 * @property {string} [pagePath] - Source-relative page path associated with page-owned output.
 * @property {string} [pageUrl] - Canonical public URL for the page associated with this output.
 * @property {string} [templatePath] - Source-relative template path associated with template output.
 * @property {Record<string, unknown>} [pageVars] - Copyable top-level page variables available to manifest option transforms.
 * @property {string} [manifestRole] - Explicit user-provided role for this output.
 * @property {Record<string, unknown>} [manifestVars] - Explicit page/app variables to expose on this manifest entry.

 * @property {string} [contentType] - Best-known MIME type for this output.
 * @property {string} [integrity] - SRI-formatted digest for this output.
 * @property {boolean} [urlRevisioned] - Whether the output URL already changes with content.
 * @property {boolean} [static] - Whether this output is static browser-loadable output.
 * @property {string} [role] - Normalized runtime purpose for this output.
 * @property {DomstackManifestEntryPageMeta} [page] - Page metadata copied onto page manifest entries.
 */

/**
 * @typedef {FromSchema<typeof domstackManifestEntrySchema>} DomstackManifestEntryShape
 */

/**
 * @template [ManifestVars=Record<string, unknown>]
 * @typedef {Omit<DomstackManifestEntryShape, 'manifestVars'> & { manifestVars?: ManifestVars }} DomstackManifestEntry
 */

/**
 * @typedef {FromSchema<typeof domstackManifestSchema>} DomstackManifestShape
 */

/**
 * @template [Policy=Record<string, unknown>]
 * @template [ManifestVars=Record<string, unknown>]
 * @typedef {Omit<DomstackManifestShape, 'entries' | 'policy'> & { entries: DomstackManifestEntry<ManifestVars>[], policy?: Policy }} DomstackManifest
 */

/**
 * @template [ManifestVars=Record<string, unknown>]
 * @template [SourceVars=Record<string, unknown>]
 * @typedef {object} DomstackManifestTransformContext
 * @property {SourceVars} vars - Source variables associated with this entry, when available.
 * @property {DomstackManifestEntry<ManifestVars>} entry - Public manifest entry before transformed fields are attached.
 * @property {{ path?: string, url?: string } | undefined} [pageInfo] - Page identity for page-owned entries.
 */

/**
 * @template [Value=Record<string, unknown>]
 * @template [ManifestVars=Record<string, unknown>]
 * @template [SourceVars=Record<string, unknown>]
 * @callback DomstackManifestTransform
 * @param {DomstackManifestTransformContext<ManifestVars, SourceVars>} context
 * @returns {Value | undefined | Promise<Value | undefined>}
 */

/**
 * @template [Policy=Record<string, unknown>]
 * @template [ManifestVars=Record<string, unknown>]
 * @typedef {object} DomstackManifestPolicyTransformContext
 * @property {DomstackManifestEntry<ManifestVars>[]} entries - Final public manifest entries after excludes, filters, and entry-level manifestVars are applied.
 */

/**
 * @template [Policy=Record<string, unknown>]
 * @template [ManifestVars=Record<string, unknown>]
 * @callback DomstackManifestPolicyTransform
 * @param {DomstackManifestPolicyTransformContext<Policy, ManifestVars>} context
 * @returns {Policy | undefined | Promise<Policy | undefined>}
 */

/**
 * @template [Policy=Record<string, unknown>]
 * @template [ManifestVars=Record<string, unknown>]
 * @typedef {object} DomstackManifestBuiltHookContext
 * @property {string} dest - Absolute output directory for the current build.
 * @property {DomstackManifest<Policy, ManifestVars>} manifest - Final domstack manifest after entries and root policy are resolved.
 * @property {(identifier: string, value: unknown) => void} defineServiceWorkerConstant - Define a JSON-serializable constant available only to the final service-worker bundle.
 * @property {(outputRelname: string, contents: string | Uint8Array) => Promise<void>} writeFile - Write a generated file under `dest`.
 */

/**
 * @template [Policy=Record<string, unknown>]
 * @template [ManifestVars=Record<string, unknown>]
 * @callback DomstackManifestBuiltHook
 * @param {DomstackManifestBuiltHookContext<Policy, ManifestVars>} context
 * @returns {void | Promise<void>}
 */

/**
 * @typedef {object} DomstackManifestBuiltHookResult
 * @property {Record<string, string>} serviceWorkerDefines - Esbuild define expressions collected for the final service-worker build.
 */

/**
 * @template [Policy=Record<string, unknown>]
 * @template [ManifestVars=Record<string, unknown>]
 * @typedef {object} DomstackManifestHooks
 * @property {DomstackManifestBuiltHook<Policy, ManifestVars>[]} [manifestBuilt] - Hooks that run after the manifest is built and before it is written.
 */

/**
 * @template [Policy=Record<string, unknown>]
 * @template [ManifestVars=Record<string, unknown>]
 * @template [SourceVars=Record<string, unknown>]
 * @typedef {object} DomstackManifestOptions
 * @property {string[]} [exclude] - Glob patterns for manifest entries to exclude by URL path or output relname.
 * @property {(entry: DomstackManifestEntry<ManifestVars>) => boolean | Promise<boolean>} [includeEntry] - Optional predicate that receives the public manifest entry before it is kept.
 * @property {string[] | DomstackManifestTransform<ManifestVars, ManifestVars, SourceVars>} [manifestVars] - Variables to expose on `entry.manifestVars`, either by allowlist or transform.
 * @property {Policy | DomstackManifestPolicyTransform<Policy, ManifestVars>} [policy] - Freeform policy to expose once at manifest root, either as an object or generated from final entries.
 * @property {DomstackManifestHooks<Policy, ManifestVars>} [hooks] - Manifest lifecycle hooks for generated artifacts such as service-worker policies or Workbox manifests.
 */

/**
 * Programmatic manifest configuration accepted by `DomStackOpts`.
 *
 * @template [Policy=Record<string, unknown>]
 * @template [ManifestVars=Record<string, unknown>]
 * @template [SourceVars=Record<string, unknown>]
 * @typedef {DomstackManifestOptions<Policy, ManifestVars, SourceVars> & {
 *   write?: boolean
 * }} DomstackManifestConfig
 */

/**
 * A manifest record after its output file has been normalized and revisioned.
 *
 * @typedef {DomstackManifestRecord & {
 *   url: string,
 *   revision: string | null,
 *   bytes: number | null
 * }} DomstackManifestInternalEntry
 */

/**
 * @typedef {object} ReconcileDomstackManifestResult
 * @property {DomstackManifest} manifest
 * @property {DomStackWarning[]} warnings
 */

function readPackageVersion () {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const version = /** @type {{ version?: unknown }} */ (packageJson).version
  if (typeof version !== 'string') throw new Error('Unable to resolve package version for domstack manifest schema')
  return version
}
