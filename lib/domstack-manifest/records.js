/**
 * @import { DomstackManifestKind, DomstackManifestEntryPageMeta, DomstackManifestRecord, DomstackManifestEntry, DomstackManifestInternalEntry } from './schema.js'
 */
import { stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { contentType } from 'mime-types'
import { assertInsideDest, toPosix } from '../helpers/path.js'
import { hashFileDigest, revisionToIntegrity } from './hash.js'

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
 * @param {Record<string, unknown>} [params.pageVars] - Copyable top-level page variables available to manifest option transforms.
 * @param {string | undefined} [params.manifestRole] - Explicit user-provided role for this output.
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
export async function createEntry ({ dest, record }) {
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
export function normalizeExistingEntry ({ dest, entry }) {
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
 * @param {string} entryPoint
 */
function normalizeEntryPoint (entryPoint) {
  return entryPoint.startsWith('file:')
    ? new URL(entryPoint).pathname
    : toPosix(entryPoint)
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
