/**
 * @import { DomStackOpts } from '../builder.js'
 * @import { FromSchema, JSONSchema } from 'json-schema-to-ts'
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import ignore from 'ignore'
import { resolveVars } from '../build-pages/resolve-vars.js'

export const DEFAULT_DOMSTACK_MANIFEST_FILENAME = 'domstack-manifest.json'
export const DOMSTACK_MANIFEST_SCHEMA_PATH = 'lib/domstack-manifest/schema.json'
// The published JSON schema URL is versioned so manifest files keep pointing at the
// schema contract they were generated against after future domstack releases.
export const DOMSTACK_MANIFEST_SCHEMA_ID = getDomstackManifestSchemaId(readPackageVersion())

// Manifest schema and public types

// These schema objects are the source of truth for both runtime manifest validation and
// the public TypeScript/JSDoc types derived below with json-schema-to-ts.
/** @satisfies {JSONSchema} */
export const domstackManifestKindSchema = /** @type {const} */ ({
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
})

/** @satisfies {JSONSchema} */
export const domstackManifestEntryPageMetaSchema = /** @type {const} */ ({
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
})

/** @satisfies {JSONSchema} */
export const domstackManifestEntrySchema = /** @type {const} */ ({
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
    page: domstackManifestEntryPageMetaSchema,
  },
  required: ['outputRelname', 'kind', 'url', 'revision', 'bytes'],
  additionalProperties: false,
})

/** @satisfies {JSONSchema} */
export const domstackManifestSchema = /** @type {const} */ ({
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
  },
  required: ['$schema', 'version', 'generatedAt', 'entries'],
  additionalProperties: false,
})

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
 * @property {string} outputRelname
 * @property {string} filepath
 * @property {DomstackManifestKind} kind
 * @property {string} [url]
 * @property {string} [sourceRelname]
 * @property {string} [entryPoint]
 * @property {string} [pagePath]
 * @property {string} [pageUrl]
 * @property {string} [templatePath]
 * @property {DomstackManifestEntryPageMeta} [page]
 */

/**
 * @typedef {FromSchema<typeof domstackManifestEntrySchema>} DomstackManifestEntry
 */

/**
 * @typedef {FromSchema<typeof domstackManifestSchema>} DomstackManifest
 */

/**
 * @typedef {object} DomstackManifestOptions
 * @property {string[]} [exclude]
 * @property {(entry: DomstackManifestEntry) => boolean | Promise<boolean>} [includeEntry]
 * @property {string} [filename]
 */

// TODO: If a concrete client needs Workbox integration, consider adding an
// optional derived artifact that projects manifest entries to Workbox's
// `{ url, revision }` precache shape. Keep the domstack manifest as the richer
// source of truth until that use case can validate the exact API.

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
  /** @type {Map<string, DomstackManifestRecord & { url: string, revision: string | null, bytes: number | null }>} */
  const entryMap = new Map()

  for (const entry of existingEntries) {
    setEntry(entryMap, normalizeExistingEntry({ dest, entry }))
  }

  for (const record of records) {
    const entry = await createEntry({ dest, record })
    setEntry(entryMap, entry)
  }

  entryMap.delete(toPosix(options.filename ?? DEFAULT_DOMSTACK_MANIFEST_FILENAME))

  let finalEntries = Array.from(entryMap.values())
    .filter(entry => entry.revision)
    .sort((a, b) => a.url.localeCompare(b.url))

  finalEntries = applyExclude(finalEntries, options.exclude ?? [])

  if (options.includeEntry) {
    /** @type {Array<DomstackManifestRecord & { url: string, revision: string | null, bytes: number | null }>} */
    const included = []
    for (const entry of finalEntries) {
      if (await options.includeEntry(toPublicEntry(entry))) included.push(entry)
    }
    finalEntries = included
  }

  const version = createHash('sha256')
  for (const entry of finalEntries) {
    updateManifestVersionHash(version, toPublicEntry(entry))
  }

  return {
    $schema: DOMSTACK_MANIFEST_SCHEMA_ID,
    version: version.digest('hex'),
    generatedAt: new Date().toISOString(),
    entries: finalEntries.map(toPublicEntry),
  }
}

// Public build-step helpers

/**
 * Create a normalized record for a file inside dest.
 *
 * @param {object} params
 * @param {string} params.dest
 * @param {string} [params.filepath]
 * @param {string} [params.outputRelname]
 * @param {DomstackManifestKind} params.kind
 * @param {string} [params.url]
 * @param {string} [params.sourceRelname]
 * @param {string} [params.entryPoint]
 * @param {string} [params.pagePath]
 * @param {string} [params.pageUrl]
 * @param {string} [params.templatePath]
 * @param {DomstackManifestEntryPageMeta} [params.page]
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
    ...(page ? { page } : {}),
  }
}

/**
 * Convert a cpx2 report into output records.
 *
 * @param {object} params
 * @param {string} params.src
 * @param {string} params.dest
 * @param {unknown} params.report
 * @param {'static'|'copy'} params.kind
 * @returns {DomstackManifestRecord[]}
 */
export function createCopiedDomstackManifestRecords ({ src, dest, report, kind }) {
  return extractCopiedFiles(report).map(copiedFile => {
    const filepath = resolve(copiedFile.output)
    return createDomstackManifestRecord({
      dest,
      filepath,
      kind,
      sourceRelname: copiedFile.source ? toPosix(relative(src, resolve(copiedFile.source))) : undefined,
    })
  })
}

/**
 * Classify a dest-relative esbuild output.
 *
 * @param {object} params
 * @param {string} params.outputRelname
 * @param {string | undefined} params.entryPoint
 * @param {Set<string>} params.workerOutputRelnames
 * @param {string | undefined} [params.serviceWorkerOutputRelname]
 * @returns {DomstackManifestKind}
 */
export function classifyEsbuildOutput ({ outputRelname, entryPoint, workerOutputRelnames, serviceWorkerOutputRelname }) {
  const ext = extname(outputRelname)

  if (ext === '.map') return 'sourcemap'
  if (serviceWorkerOutputRelname && outputRelname === serviceWorkerOutputRelname) return 'service-worker'
  if (workerOutputRelnames.has(outputRelname)) return 'worker'
  if (ext === '.css') return 'style'
  if (ext === '.js' && entryPoint) return 'script'
  return 'chunk'
}

// Manifest writing and options

/**
 * @param {string} dest
 * @param {DomstackManifest} domstackManifest
 * @param {string} [filename]
 */
export async function writeDomstackManifest (dest, domstackManifest, filename = DEFAULT_DOMSTACK_MANIFEST_FILENAME) {
  const manifestPath = resolve(dest, filename)
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
  const domstackManifestSettings = await resolveVars({
    varsPath: domstackManifestSettingsPath,
  })
  const includeEntry = typeof /** @type {{ includeEntry?: unknown }} */ (domstackManifestSettings).includeEntry === 'function'
    ? /** @type {(entry: DomstackManifestEntry) => boolean | Promise<boolean>} */ (/** @type {{ includeEntry: unknown }} */ (domstackManifestSettings).includeEntry)
    : undefined

  /** @type {DomstackManifestOptions} */
  const options = {
    exclude: [
      ...((Array.isArray(domstackManifestOpts.exclude) ? domstackManifestOpts.exclude : [])),
      ...((Array.isArray(/** @type {{ exclude?: unknown }} */ (domstackManifestSettings).exclude) ? /** @type {string[]} */ (/** @type {{ exclude: unknown }} */ (domstackManifestSettings).exclude) : [])),
    ],
    filename: getDomstackManifestFilename(opts),
  }

  if (includeEntry) options.includeEntry = includeEntry

  return options
}

/**
 * @param {DomStackOpts | undefined} opts
 */
export function shouldWriteDomstackManifest (opts) {
  if (opts?.domstackManifest === false) return false
  if (typeof opts?.domstackManifest === 'object' && opts.domstackManifest.write === false) return false
  return true
}

/**
 * @param {DomStackOpts | undefined} opts
 */
export function getDomstackManifestFilename (opts) {
  return typeof opts?.domstackManifest === 'object' && typeof opts.domstackManifest.filename === 'string'
    ? opts.domstackManifest.filename
    : DEFAULT_DOMSTACK_MANIFEST_FILENAME
}

/**
 * @param {string} relname
 */
export function outputRelnameToUrl (relname) {
  const posixRelname = toPosix(relname)
  return `/${posixRelname === 'index.html' ? '' : posixRelname.replace(/\/index\.html$/, '/')}`
}

// Path helpers shared by build steps

/**
 * @param {string} value
 */
export function toPosix (value) {
  return value.split(sep).join('/')
}

/**
 * @param {object} params
 * @param {string} params.dest
 * @param {DomstackManifestRecord} params.record
 * @returns {Promise<(DomstackManifestRecord & { url: string, revision: string | null, bytes: number | null }) | null>}
 */
async function createEntry ({ dest, record }) {
  const filepath = resolve(record.filepath)
  assertInsideDest(dest, filepath)
  if (!(await fileExists(filepath))) return null

  const [revision, fileStat] = await Promise.all([
    hashFile(filepath),
    stat(filepath),
  ])

  return {
    ...record,
    outputRelname: toPosix(record.outputRelname),
    filepath,
    url: record.url ?? outputRelnameToUrl(record.outputRelname),
    revision,
    bytes: fileStat.size,
  }
}

/**
 * @param {object} params
 * @param {string} params.dest
 * @param {DomstackManifestEntry} params.entry
 * @returns {DomstackManifestRecord & { url: string, revision: string | null, bytes: number | null }}
 */
function normalizeExistingEntry ({ dest, entry }) {
  const filepath = resolve(dest, entry.outputRelname)
  assertInsideDest(dest, filepath)

  return {
    ...entry,
    outputRelname: toPosix(entry.outputRelname),
    filepath,
    url: entry.url ?? outputRelnameToUrl(entry.outputRelname),
  }
}

/**
 * @param {Map<string, DomstackManifestRecord & { url: string, revision: string | null, bytes: number | null }>} entries
 * @param {(DomstackManifestRecord & { url: string, revision: string | null, bytes: number | null }) | null} entry
 */
function setEntry (entries, entry) {
  if (!entry) return
  const existing = entries.get(entry.outputRelname)
  if (!existing || priority(entry.kind) >= priority(existing.kind)) {
    entries.set(entry.outputRelname, entry)
  }
}

/**
 * Project internal output records onto the serialized manifest contract. Keep this
 * explicit so new internal fields cannot accidentally leak into public JSON.
 *
 * @param {DomstackManifestRecord & { url: string, revision: string | null, bytes: number | null }} entry
 * @returns {DomstackManifestEntry}
 */
function toPublicEntry (entry) {
  return {
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
    ...(entry.page ? { page: entry.page } : {}),
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

  const serializedValue = stableJsonStringify(vars[key])
  hash.update(serializedValue ?? '')
  hash.update('\0')
}

/**
 * Stable JSON serialization for cache policy values. It first applies JSON's own
 * serialization rules, then sorts object keys before hashing.
 *
 * @param {unknown} value
 * @returns {string | undefined}
 */
function stableJsonStringify (value) {
  const serializedValue = JSON.stringify(value)
  return serializedValue === undefined
    ? undefined
    : stableJsonStringifyValue(JSON.parse(serializedValue))
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function stableJsonStringifyValue (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)

  if (Array.isArray(value)) {
    return `[${value.map(item => stableJsonStringifyValue(item) ?? 'null').join(',')}]`
  }

  const serializedProperties = Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, item]) => {
      const serializedItem = stableJsonStringifyValue(item)
      return serializedItem === undefined ? [] : `${JSON.stringify(key)}:${serializedItem}`
    })

  return `{${serializedProperties.join(',')}}`
}

/**
 * @param {Array<DomstackManifestRecord & { url: string, revision: string | null, bytes: number | null }>} entries
 * @param {string[]} exclude
 */
function applyExclude (entries, exclude) {
  if (exclude.length === 0) return entries

  const ig = ignore().add(exclude.map(pattern => pattern.startsWith('/') ? pattern.slice(1) : pattern))

  return entries.filter(entry => {
    const urlPath = entry.url.startsWith('/') ? entry.url.slice(1) : entry.url
    return !isIgnoredPath(ig, urlPath) && !isIgnoredPath(ig, entry.outputRelname)
  })
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

// Copy-report helpers

/**
 * @param {unknown} report
 * @returns {{ source?: string, output: string }[]}
 */
function extractCopiedFiles (report) {
  /** @type {{ source?: string, output: string }[]} */
  const copied = []

  const visit = (/** @type {unknown} */ value) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }

    const maybeCopied = /** @type {{ source?: unknown, output?: unknown, copied?: unknown }} */ (value)
    if (typeof maybeCopied.output === 'string') {
      copied.push({
        ...(typeof maybeCopied.source === 'string' ? { source: maybeCopied.source } : {}),
        output: maybeCopied.output,
      })
    }

    for (const child of Object.values(value)) visit(child)
  }

  visit(report)
  return copied
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
async function hashFile (filepath) {
  const contents = await readFile(filepath)
  return createHash('sha256').update(contents).digest('hex')
}

/**
 * @param {string} filepath
 */
async function fileExists (filepath) {
  try {
    const fileStat = await stat(filepath)
    return fileStat.isFile()
  } catch {
    return false
  }
}

/**
 * @param {string} dest
 * @param {string} filepath
 */
function assertInsideDest (dest, filepath) {
  const absDest = resolve(dest)
  const absFilepath = resolve(filepath)
  const rel = relative(absDest, absFilepath)
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error(`Output path escapes dest: ${filepath}`)
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
 * @param {DomstackManifestKind} kind
 */
function priority (kind) {
  return KIND_PRIORITY.get(kind) ?? -1
}
