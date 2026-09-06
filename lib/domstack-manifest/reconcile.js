/**
 * @import { DomStackWarning } from '../helpers/domstack-warning.js'
 * @import { DomstackManifestRecord, DomstackManifestEntry, DomstackManifestInternalEntry, DomstackManifestOptions, ReconcileDomstackManifestResult } from './schema.js'
 */
import { createHash } from 'node:crypto'
import ignore from 'ignore'
import { toPosix } from '../helpers/path.js'
import { DEFAULT_DOMSTACK_MANIFEST_FILENAME, DOMSTACK_MANIFEST_SCHEMA_ID } from './schema.js'
import { createEntry, normalizeExistingEntry } from './records.js'
import { updateManifestVersionHash, updateManifestVersionValue } from './hash.js'

// Prefer the output type with the most specific runtime meaning when builders
// report the same output path more than once.
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

/**
 * Reconcile records emitted by build steps into a normalized, revisioned manifest.
 *
 * @param {object} params
 * @param {string} params.dest
 * @param {DomstackManifestRecord[]} [params.records]
 * @param {DomstackManifestEntry[]} [params.entries]
 * @param {DomstackManifestOptions} [params.options]
 * @returns {Promise<ReconcileDomstackManifestResult>}
 */
export async function reconcileDomstackManifest ({ dest, records = [], entries: existingEntries = [], options = {} }) {
  const manifestOutputRelname = DEFAULT_DOMSTACK_MANIFEST_FILENAME
  const excludeMatcher = createExcludeMatcher(options.exclude ?? [])
  /** @type {Map<string, DomstackManifestInternalEntry>} */
  const entryMap = new Map()
  /** @type {DomStackWarning[]} */
  const warnings = []

  for (const entry of existingEntries) {
    if (toPosix(entry.outputRelname) === manifestOutputRelname) continue
    setEntry(entryMap, normalizeExistingEntry({ dest, entry }), warnings)
  }

  for (const record of records) {
    if (toPosix(record.outputRelname) === manifestOutputRelname) continue
    const entry = await createEntry({ dest, record })
    setEntry(entryMap, entry, warnings)
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
    manifest: {
      $schema: DOMSTACK_MANIFEST_SCHEMA_ID,
      version: version.digest('hex'),
      generatedAt: new Date().toISOString(),
      entries: finalEntries,
      ...(policy ? { policy } : {}),
    },
    warnings,
  }
}

/**
 * @param {Map<string, DomstackManifestInternalEntry>} entries
 * @param {DomstackManifestInternalEntry | null} entry
 * @param {DomStackWarning[]} warnings
 */
function setEntry (entries, entry, warnings) {
  if (!entry) return
  const existing = entries.get(entry.outputRelname)
  const entryPriority = KIND_PRIORITY.get(entry.kind) ?? -1
  const existingPriority = existing ? KIND_PRIORITY.get(existing.kind) ?? -1 : -1
  const replaceExisting = !existing || entryPriority >= existingPriority

  if (existing) {
    const conflictingFields = getConflictingEntryFields(existing, entry)
    if (conflictingFields.length > 0) {
      const winner = replaceExisting ? entry : existing
      warnings.push({
        code: 'DOM_STACK_WARNING_CONFLICTING_MANIFEST_OUTPUT',
        message: `Conflicting manifest records target "${entry.outputRelname}" (${conflictingFields.join(', ')} differ); keeping ${describeEntryProducer(winner)}.`,
      })
    }
  }

  if (replaceExisting) entries.set(entry.outputRelname, entry)
}

/**
 * Only values supplied by both producers can conflict. A value supplied by one
 * producer alone does not contradict the other producer.
 *
 * @param {DomstackManifestInternalEntry} existing
 * @param {DomstackManifestInternalEntry} incoming
 * @returns {string[]}
 */
function getConflictingEntryFields (existing, incoming) {
  return MANIFEST_CONFLICT_FIELDS.filter(field => {
    const existingValue = existing[field]
    const incomingValue = incoming[field]
    return existingValue !== undefined &&
      incomingValue !== undefined &&
      existingValue !== incomingValue
  })
}

/**
 * @param {DomstackManifestInternalEntry} entry
 */
function describeEntryProducer (entry) {
  const source = entry.sourceRelname ?? entry.entryPoint ?? entry.templatePath
  return source ? `${entry.kind} record from "${source}"` : `${entry.kind} record`
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

  const vars = entry.pageVars ?? {}

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
const MANIFEST_CONFLICT_FIELDS = /** @type {const} */ ([
  'kind',
  'url',
  'sourceRelname',
  'entryPoint',
  'pagePath',
  'pageUrl',
  'templatePath',
])
