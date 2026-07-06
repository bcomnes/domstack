/**
 * @import { DomStackOpts } from '../builder.js'
 * @import { FromSchema, JSONSchema } from 'json-schema-to-ts'
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import ignore from 'ignore'
import { contentType } from 'mime-types'
import { resolveVars } from '../build-pages/resolve-vars.js'
import { assertInsideDest, toPosix } from '../helpers/path.js'
import { stableJsonStringify } from '../helpers/stable-json-stringify.js'
import { isFunction, isPlainObject } from '../helpers/type-guards.js'

export const DEFAULT_DOMSTACK_MANIFEST_FILENAME = 'domstack-manifest.json'
export const DOMSTACK_MANIFEST_SCHEMA_PATH = 'lib/domstack-manifest/schema.json'
// The published JSON schema URL is versioned so manifest files keep pointing at the
// schema contract they were generated against after future domstack releases.
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
    vars: {
      description: 'Selected page variables that can affect offline or precache policy.',
      type: 'object',
      properties: {
        precache: {
          description: 'Application-defined page precache policy metadata. Domstack records this value but does not interpret it.',
        },
        offline: {
          description: 'Application-defined page offline availability metadata. Domstack records this value but does not interpret it.',
        },
      },
      additionalProperties: false,
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
  return `https://unpkg.com/@domstack/static@${version}/${DOMSTACK_MANIFEST_SCHEMA_PATH}`
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
 * @property {Record<string, unknown>} [pageVars] - Internal page variables available to manifest option transforms.
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
 * A manifest record after its output file has been normalized and revisioned.
 *
 * @typedef {DomstackManifestRecord & {
 *   url: string,
 *   revision: string | null,
 *   bytes: number | null
 * }} DomstackManifestInternalEntry
 */

const KIND_PRIORITY = new Map([
  ['page', 100],
  ['service-worker', 95],
  ['template', 90],
  ['worker-manifest', 80],
  ['worker', 70],
  ['script', 60],
  ['style', 50],
  ['chunk', 40],
  ['static', 30],
  ['copy', 20],
  ['sourcemap', 10],
  ['metadata', 0],
])

// Manifest reconciliation

/**
 * Build a normalized, revisioned manifest from records emitted by build steps.
 *
 * @param {object} params
 * @param {string} params.dest
 * @param {DomstackManifestRecord[]} [params.records]
 * @param {DomstackManifestEntry[]} [params.entries]
 * @param {DomstackManifestOptions} [params.options]
 * @returns {Promise<DomstackManifest>}
 */
export async function buildDomstackManifest ({ dest, records = [], entries: existingEntries = [], options = {} }) {
  const manifestOutputRelname = DEFAULT_DOMSTACK_MANIFEST_FILENAME
  const excludeMatcher = createExcludeMatcher(options.exclude ?? [])
  /** @type {Map<string, DomstackManifestInternalEntry>} */
  const entryMap = new Map()

  for (const entry of existingEntries) {
    if (toPosix(entry.outputRelname) === manifestOutputRelname) continue
    setEntry(entryMap, normalizeExistingEntry({ dest, entry }))
  }

  for (const record of records) {
    if (toPosix(record.outputRelname) === manifestOutputRelname) continue
    const entry = await createEntry({ dest, record })
    setEntry(entryMap, entry)
  }

  const version = createHash('sha256')
  /** @type {DomstackManifestEntry[]} */
  const finalEntries = []
  const sortedEntries = Array.from(entryMap.values()).sort((a, b) => a.url.localeCompare(b.url))

  for (const entry of sortedEntries) {
    if (!entry.revision || isExcludedEntry(entry, excludeMatcher)) continue

    const publicEntry = await toPublicEntry(entry, options)
    if (options.includeEntry && !(await options.includeEntry(publicEntry))) continue

    updateManifestVersionHash(version, publicEntry)
    finalEntries.push(publicEntry)
  }

  const policy = await resolveManifestPolicy(options, finalEntries)
  updateManifestVersionValue(version, policy)

  return {
    $schema: DOMSTACK_MANIFEST_SCHEMA_ID,
    version: version.digest('hex'),
    generatedAt: new Date().toISOString(),
    entries: finalEntries,
    ...(policy ? { policy } : {}),
  }
}

// Public build-step helpers

/**
 * Create a normalized record for a file inside dest.
 *
 * @param {object} params
 * @param {string} params.dest - Destination directory that owns the output file.
 * @param {string} [params.filepath] - Absolute or relative filesystem path to the emitted output.
 * @param {string} [params.outputRelname] - Destination-relative output path when `filepath` should not be relativized.
 * @param {DomstackManifestKind} params.kind - Build artifact category for this output.
 * @param {string} [params.url] - Public same-origin URL when the default output path URL is not correct.
 * @param {string} [params.sourceRelname] - Source-relative path that produced this output when known.
 * @param {string} [params.entryPoint] - esbuild entry point path for bundled outputs when available.
 * @param {string} [params.pagePath] - Source-relative page path for page-owned outputs.
 * @param {string} [params.pageUrl] - Canonical public page URL for page-owned outputs.
 * @param {string} [params.templatePath] - Source-relative template path for template outputs.
 * @param {Record<string, unknown>} [params.pageVars] - Internal page variables available to manifest option transforms.
 * @param {string} [params.manifestRole] - Explicit user-provided role for this output.
 * @param {Record<string, unknown>} [params.manifestVars] - Explicit page/app variables to expose on this manifest entry.

 * @param {DomstackManifestEntryPageMeta} [params.page] - Page metadata to copy onto page entries.
 * @returns {DomstackManifestRecord}
 */
export function createDomstackManifestRecord ({
  dest,
  filepath,
  outputRelname,
  kind,
  url,
  sourceRelname,
  entryPoint,
  pagePath,
  pageUrl,
  templatePath,
  pageVars,
  manifestRole,
  manifestVars,
  page,
}) {
  const resolvedFilepath = filepath
    ? resolve(filepath)
    : resolve(dest, outputRelname ?? '')
  assertInsideDest(dest, resolvedFilepath)

  const normalizedOutputRelname = toPosix(outputRelname ?? relative(dest, resolvedFilepath))

  return {
    outputRelname: normalizedOutputRelname,
    filepath: resolvedFilepath,
    kind,
    url: url ?? outputRelnameToUrl(normalizedOutputRelname),
    ...(sourceRelname ? { sourceRelname: toPosix(sourceRelname) } : {}),
    ...(entryPoint ? { entryPoint: normalizeEntryPoint(entryPoint) } : {}),
    ...(pagePath ? { pagePath } : {}),
    ...(pageUrl ? { pageUrl } : {}),
    ...(templatePath ? { templatePath } : {}),
    ...(pageVars ? { pageVars } : {}),
    ...(manifestRole ? { manifestRole } : {}),
    ...(manifestVars ? { manifestVars } : {}),
    ...(page ? { page } : {}),
  }
}

// Manifest writing and options

/**
 * @param {string} dest
 * @param {DomstackManifest} domstackManifest
 */
export async function writeDomstackManifest (dest, domstackManifest) {
  const manifestPath = resolve(dest, DEFAULT_DOMSTACK_MANIFEST_FILENAME)
  assertInsideDest(dest, manifestPath)
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, JSON.stringify(domstackManifest, null, 2))
}

/**
 * @param {object} params
 * @param {string | undefined} params.domstackManifestSettingsPath
 * @param {DomStackOpts | undefined} params.opts
 * @returns {Promise<DomstackManifestOptions>}
 */
export async function resolveDomstackManifestOptions ({ domstackManifestSettingsPath, opts }) {
  const domstackManifestOpts = typeof opts?.domstackManifest === 'object'
    ? opts.domstackManifest
    : {}
  const domstackManifestSettings = /** @type {Partial<DomstackManifestOptions>} */ (await resolveVars({
    varsPath: domstackManifestSettingsPath,
  }))
  const includeEntry = isFunction(domstackManifestSettings.includeEntry)
    ? domstackManifestSettings.includeEntry
    : undefined
  const manifestVars = normalizeManifestFieldSetting(domstackManifestSettings.manifestVars ?? domstackManifestOpts.manifestVars)
  const policy = normalizeManifestPolicySetting(domstackManifestSettings.policy ?? domstackManifestOpts.policy)
  /** @type {DomstackManifestOptions} */
  const options = {
    exclude: [
      ...toStringArray(domstackManifestOpts.exclude),
      ...toStringArray(domstackManifestSettings.exclude),
    ],
  }

  const hooks = mergeManifestHooks(domstackManifestOpts.hooks, domstackManifestSettings.hooks)

  if (includeEntry) options.includeEntry = includeEntry
  if (manifestVars) options.manifestVars = manifestVars
  if (policy) options.policy = policy
  if (hooks) options.hooks = hooks

  return options
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function toStringArray (value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string')
    : []
}

/**
 * @param {unknown} value
 * @returns {DomstackManifestOptions['manifestVars'] | undefined}
 */
function normalizeManifestFieldSetting (value) {
  if (isFunction(value)) return /** @type {DomstackManifestTransform} */ (value)
  const allowlist = toStringArray(value)
  return allowlist.length > 0 ? allowlist : undefined
}

/**
 * @param {unknown} value
 * @returns {DomstackManifestOptions['policy'] | undefined}
 */
function normalizeManifestPolicySetting (value) {
  if (isFunction(value)) return /** @type {DomstackManifestPolicyTransform} */ (value)
  return isPlainObject(value) ? value : undefined
}

/**
 * @param {DomstackManifestOptions['hooks'] | undefined} first
 * @param {DomstackManifestOptions['hooks'] | undefined} second
 * @returns {DomstackManifestOptions['hooks'] | undefined}
 */
function mergeManifestHooks (first, second) {
  const manifestBuilt = [
    ...toFunctionArray(first?.manifestBuilt),
    ...toFunctionArray(second?.manifestBuilt),
  ]

  return manifestBuilt.length > 0 ? { manifestBuilt } : undefined
}

/**
 * @param {unknown} value
 * @returns {DomstackManifestBuiltHook[]}
 */
function toFunctionArray (value) {
  return Array.isArray(value)
    ? /** @type {DomstackManifestBuiltHook[]} */ (value.filter(isFunction))
    : []
}

/**
 * @param {string} dest
 * @param {string} outputRelname
 * @param {string | Uint8Array} contents
 */
async function writeGeneratedManifestFile (dest, outputRelname, contents) {
  const filepath = resolve(dest, outputRelname)
  assertInsideDest(dest, filepath)
  await mkdir(dirname(filepath), { recursive: true })
  await writeFile(filepath, contents)
}

/**
 * Run generated-artifact hooks after the domstack manifest has been built.
 *
 * @param {string} dest
 * @param {DomstackManifest} manifest
 * @param {DomstackManifestOptions} options
 * @returns {Promise<DomstackManifestBuiltHookResult>}
 */
export async function runDomstackManifestBuiltHooks (dest, manifest, options) {
  const serviceWorkerDefines = /** @type {Record<string, string>} */ ({})
  const hooks = options.hooks?.manifestBuilt ?? []

  for (const hook of hooks) {
    await hook({
      dest,
      manifest,
      defineServiceWorkerConstant: (identifier, value) => {
        serviceWorkerDefines[identifier] = JSON.stringify(value)
      },
      writeFile: (outputRelname, contents) => writeGeneratedManifestFile(dest, outputRelname, contents),
    })
  }

  return { serviceWorkerDefines }
}

/**
 * @param {object} params
 * @param {string | undefined} params.domstackManifestSettingsPath
 * @param {DomStackOpts | undefined} params.opts
 */
export function isDomstackManifestEnabled ({ domstackManifestSettingsPath, opts }) {
  return Boolean(domstackManifestSettingsPath || opts?.domstackManifest)
}

/**
 * @param {DomStackOpts | undefined} opts
 */
export function shouldWriteDomstackManifest (opts) {
  if (opts?.domstackManifest === true) return true
  return typeof opts?.domstackManifest === 'object' && opts.domstackManifest.write === true
}

/**
 * @param {string} relname
 */
export function outputRelnameToUrl (relname) {
  const posixRelname = toPosix(relname)
  return `/${posixRelname === 'index.html' ? '' : posixRelname.replace(/\/index\.html$/, '/')}`
}

/**
 * @param {object} params
 * @param {string} params.dest
 * @param {DomstackManifestRecord} params.record
 * @returns {Promise<DomstackManifestInternalEntry | null>}
 */
async function createEntry ({ dest, record }) {
  const filepath = resolve(record.filepath)
  assertInsideDest(dest, filepath)
  let fileStat
  try {
    fileStat = await stat(filepath)
  } catch {
    return null
  }
  if (!fileStat.isFile()) return null

  const digest = await hashFileDigest(filepath)
  const outputRelname = toPosix(record.outputRelname)
  const url = record.url ?? outputRelnameToUrl(record.outputRelname)

  /** @type {DomstackManifestInternalEntry} */
  const entry = {
    ...record,
    outputRelname,
    filepath,
    url,
    revision: digest.hex,
    integrity: record.integrity ?? digest.integrity,
    bytes: fileStat.size,
  }

  applyDerivedEntryFields(entry)
  return entry
}

/**
 * @param {object} params
 * @param {string} params.dest
 * @param {DomstackManifestEntry} params.entry
 * @returns {DomstackManifestInternalEntry}
 */
function normalizeExistingEntry ({ dest, entry }) {
  const filepath = resolve(dest, entry.outputRelname)
  assertInsideDest(dest, filepath)
  const outputRelname = toPosix(entry.outputRelname)
  const url = entry.url ?? outputRelnameToUrl(entry.outputRelname)

  /** @type {DomstackManifestInternalEntry} */
  const normalizedEntry = {
    ...entry,
    outputRelname,
    filepath,
    url,
  }

  if (!normalizedEntry.integrity) {
    const integrity = revisionToIntegrity(normalizedEntry.revision)
    if (integrity) normalizedEntry.integrity = integrity
  }

  applyDerivedEntryFields(normalizedEntry)
  return normalizedEntry
}

/**
 * @param {Map<string, DomstackManifestInternalEntry>} entries
 * @param {DomstackManifestInternalEntry | null} entry
 */
function setEntry (entries, entry) {
  if (!entry) return
  const existing = entries.get(entry.outputRelname)
  const entryPriority = KIND_PRIORITY.get(entry.kind) ?? -1
  const existingPriority = existing ? KIND_PRIORITY.get(existing.kind) ?? -1 : -1
  if (!existing || entryPriority >= existingPriority) entries.set(entry.outputRelname, entry)
}

/**
 * Apply derived fields that can be computed from existing build output facts.
 * This keeps record-created and existing-entry reconciliation behavior aligned.
 *
 * @param {DomstackManifestInternalEntry} entry
 */
function applyDerivedEntryFields (entry) {
  if (!entry.contentType) {
    const contentType = inferContentType(entry.outputRelname)
    if (contentType) entry.contentType = contentType
  }

  entry.urlRevisioned = entry.urlRevisioned ?? inferUrlRevisioned(entry)
  entry.static = entry.static ?? inferStatic(entry.kind)
  entry.role = entry.manifestRole ?? entry.role ?? inferRole(entry)
}

/**
 * @param {object} params
 * @param {DomstackManifestInternalEntry} params.entry
 * @param {DomstackManifestEntry} params.publicEntry
 * @param {DomstackManifestOptions} params.options
 * @param {'manifestVars'} params.field
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
async function resolveManifestField ({ entry, publicEntry, options, field }) {
  const setting = options[field]
  const existing = entry[field]
  if (!setting) return existing

  const vars = entry.pageVars ?? entry.page?.vars ?? {}

  if (Array.isArray(setting)) {
    const selected = pickManifestField(vars, setting)
    return mergeManifestField(existing, selected)
  }

  const transformed = await setting({
    vars,
    entry: publicEntry,
    pageInfo: entry.page ? { path: entry.page.path, url: entry.page.url } : undefined,
  })

  return mergeManifestField(existing, transformed)
}

/**
 * @param {Record<string, unknown>} vars
 * @param {string[]} keys
 * @returns {Record<string, unknown> | undefined}
 */
function pickManifestField (vars, keys) {
  const selected = /** @type {Record<string, unknown>} */ ({})
  for (const key of keys) {
    if (Object.hasOwn(vars, key)) selected[key] = vars[key]
  }
  return Object.keys(selected).length > 0 ? selected : undefined
}

/**
 * @param {Record<string, unknown> | undefined} base
 * @param {Record<string, unknown> | undefined} next
 * @returns {Record<string, unknown> | undefined}
 */
function mergeManifestField (base, next) {
  if (!base && !next) return undefined
  return { ...(base ?? {}), ...(next ?? {}) }
}

/**
 * @param {DomstackManifestOptions} options
 * @param {DomstackManifestEntry[]} entries
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
async function resolveManifestPolicy (options, entries) {
  if (!options.policy) return undefined
  if (typeof options.policy === 'function') {
    return await options.policy({ entries })
  }
  return options.policy
}

/**
 * Project internal output records onto the serialized manifest contract. Keep this
 * explicit so new internal fields cannot accidentally leak into public JSON.
 *
 * @param {DomstackManifestInternalEntry} entry
 * @param {DomstackManifestOptions} options
 * @returns {Promise<DomstackManifestEntry>}
 */
async function toPublicEntry (entry, options) {
  const publicEntry = {
    outputRelname: entry.outputRelname,
    kind: entry.kind,
    url: entry.url,
    revision: entry.revision,
    bytes: entry.bytes,
    ...(entry.sourceRelname ? { sourceRelname: entry.sourceRelname } : {}),
    ...(entry.entryPoint ? { entryPoint: entry.entryPoint } : {}),
    ...(entry.pagePath ? { pagePath: entry.pagePath } : {}),
    ...(entry.pageUrl ? { pageUrl: entry.pageUrl } : {}),
    ...(entry.templatePath ? { templatePath: entry.templatePath } : {}),
    ...(entry.contentType ? { contentType: entry.contentType } : {}),
    ...(entry.integrity ? { integrity: entry.integrity } : {}),
    ...(entry.manifestVars ? { manifestVars: entry.manifestVars } : {}),
    ...(typeof entry.urlRevisioned === 'boolean' ? { urlRevisioned: entry.urlRevisioned } : {}),
    ...(typeof entry.static === 'boolean' ? { static: entry.static } : {}),
    ...(entry.role ? { role: entry.role } : {}),
    ...(entry.page ? { page: entry.page } : {}),
  }

  const manifestVars = await resolveManifestField({ entry, publicEntry, options, field: 'manifestVars' })
  return {
    ...publicEntry,
    ...(manifestVars ? { manifestVars } : {}),
  }
}

/**
 * Hash only the fields that affect static cache membership and content. Source
 * metadata is intentionally ignored so debug/build-origin changes do not churn
 * PWA cache names.
 *
 * @param {{ update: (value: string) => unknown }} hash
 * @param {DomstackManifestEntry} entry
 */
function updateManifestVersionHash (hash, entry) {
  hash.update(entry.url)
  hash.update('\0')
  hash.update(entry.revision ?? '')
  hash.update('\0')
  hash.update(entry.kind)
  hash.update('\0')
  updateManifestVersionValue(hash, entry.contentType)
  updateManifestVersionValue(hash, entry.integrity)
  updateManifestVersionValue(hash, entry.manifestVars)
  updateManifestVersionValue(hash, entry.urlRevisioned)
  updateManifestVersionValue(hash, entry.static)
  updateManifestVersionValue(hash, entry.role)
  updateManifestVersionPageVar(hash, entry.page?.vars, 'precache')
  updateManifestVersionPageVar(hash, entry.page?.vars, 'offline')
}

/**
 * @param {{ update: (value: string) => unknown }} hash
 * @param {{ precache?: unknown, offline?: unknown } | undefined} vars
 * @param {'precache'|'offline'} key
 */
function updateManifestVersionPageVar (hash, vars, key) {
  if (!vars || !Object.hasOwn(vars, key)) {
    hash.update('\0')
    return
  }

  updateManifestVersionValue(hash, vars[key])
}

/**
 * @param {{ update: (value: string) => unknown }} hash
 * @param {unknown} value
 */
function updateManifestVersionValue (hash, value) {
  const serializedValue = stableJsonStringify(value)
  hash.update(serializedValue ?? '')
  hash.update('\0')
}

/**
 * @param {string[]} exclude
 * @returns {ReturnType<typeof ignore> | null}
 */
function createExcludeMatcher (exclude) {
  if (exclude.length === 0) return null

  return ignore().add(exclude.map(pattern => pattern.startsWith('/') ? pattern.slice(1) : pattern))
}

/**
 * @param {DomstackManifestInternalEntry} entry
 * @param {ReturnType<typeof ignore> | null} excludeMatcher
 */
function isExcludedEntry (entry, excludeMatcher) {
  if (!excludeMatcher) return false

  const urlPath = entry.url.startsWith('/') ? entry.url.slice(1) : entry.url
  return isIgnoredPath(excludeMatcher, urlPath) || isIgnoredPath(excludeMatcher, entry.outputRelname)
}

/**
 * The ignore package rejects empty paths. The root page URL normalizes to an
 * empty path, and should only be excluded by filtering its output filename.
 *
 * @param {ReturnType<typeof ignore>} ig
 * @param {string} path
 */
function isIgnoredPath (ig, path) {
  return path !== '' && ig.ignores(path)
}

// Filesystem helpers

function readPackageVersion () {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const version = /** @type {{ version?: unknown }} */ (packageJson).version
  if (typeof version !== 'string') throw new Error('Unable to resolve package version for domstack manifest schema')
  return version
}

/**
 * @param {string} filepath
 */
async function hashFileDigest (filepath) {
  const contents = await readFile(filepath)
  const digest = createHash('sha256').update(contents).digest()
  return {
    hex: digest.toString('hex'),
    integrity: `sha256-${digest.toString('base64')}`,
  }
}

/**
 * @param {string} entryPoint
 */
function normalizeEntryPoint (entryPoint) {
  return entryPoint.startsWith('file:')
    ? new URL(entryPoint).pathname
    : toPosix(entryPoint)
}

/**
 * @param {string | null} revision
 * @returns {string | undefined}
 */
function revisionToIntegrity (revision) {
  if (!revision || !/^[a-f0-9]{64}$/i.test(revision)) return undefined
  return `sha256-${Buffer.from(revision, 'hex').toString('base64')}`
}

/**
 * @param {string} outputRelname
 * @returns {string | undefined}
 */
function inferContentType (outputRelname) {
  return contentType(outputRelname) || undefined
}

/**
 * @param {object} params
 * @param {DomstackManifestKind} params.kind
 * @param {string} params.outputRelname
 * @param {string} params.url
 * @returns {boolean}
 */
function inferUrlRevisioned ({ kind, outputRelname, url }) {
  if (kind === 'service-worker' || kind === 'metadata' || kind === 'sourcemap') return false

  return HASHED_OUTPUT_RE.test(outputRelname) || HASHED_URL_RE.test(url)
}

/**
 * @param {DomstackManifestKind} kind
 * @returns {boolean}
 */
function inferStatic (kind) {
  return !['metadata', 'service-worker', 'sourcemap'].includes(kind)
}

/**
 * @param {{ kind: DomstackManifestKind, contentType?: string }} entry
 * @returns {string}
 */
function inferRole (entry) {
  if (entry.kind === 'page' || entry.kind === 'template') return 'navigation'
  if (entry.kind === 'service-worker' || entry.kind === 'worker') return 'worker'
  if (entry.kind === 'metadata' || entry.kind === 'sourcemap' || entry.kind === 'worker-manifest') return 'metadata'
  if (entry.contentType?.startsWith('text/html')) return 'navigation'
  return 'subresource'
}

const HASHED_OUTPUT_RE = /-[A-Z0-9]{8}(?:\.[^./]+)?\.[^./]+$/
const HASHED_URL_RE = /-[A-Z0-9]{8}(?:\.[^/?#]+)?(?:[?#]|$)/
