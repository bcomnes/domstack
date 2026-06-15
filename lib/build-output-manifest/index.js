/**
 * @import { DomStackOpts } from '../builder.js'
 * @import { FromSchema, JSONSchema } from 'json-schema-to-ts'
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import ignore from 'ignore'
import { resolveVars } from '../build-pages/resolve-vars.js'

export const DEFAULT_OUTPUT_MANIFEST_FILENAME = 'domstack-output-manifest.json'
export const BUILD_OUTPUT_MANIFEST_SCHEMA_PATH = 'lib/build-output-manifest/schema.json'
// The published JSON schema URL is versioned so manifest files keep pointing at the
// schema contract they were generated against after future domstack releases.
export const BUILD_OUTPUT_MANIFEST_SCHEMA_ID = getBuildOutputManifestSchemaId(readPackageVersion())

// Manifest schema and public types

// These schema objects are the source of truth for both runtime manifest validation and
// the public TypeScript/JSDoc types derived below with json-schema-to-ts.
/** @satisfies {JSONSchema} */
export const buildOutputKindSchema = /** @type {const} */ ({
  enum: [
    'page',
    'template',
    'script',
    'style',
    'chunk',
    'worker',
    'worker-manifest',
    'static',
    'copy',
    'sourcemap',
    'metadata',
  ],
})

/** @satisfies {JSONSchema} */
export const buildOutputEntryPageMetaSchema = /** @type {const} */ ({
  type: 'object',
  properties: {
    path: { type: 'string' },
    url: { type: 'string' },
    vars: {
      type: 'object',
      properties: {
        precache: true,
        offline: true,
      },
      additionalProperties: false,
    },
  },
  required: ['path', 'url'],
  additionalProperties: false,
})

/** @satisfies {JSONSchema} */
export const buildOutputEntrySchema = /** @type {const} */ ({
  type: 'object',
  properties: {
    outputRelname: { type: 'string' },
    filepath: { type: 'string' },
    kind: buildOutputKindSchema,
    url: { type: 'string' },
    revision: { type: ['string', 'null'] },
    bytes: { type: ['integer', 'null'] },
    sourceRelname: { type: 'string' },
    entryPoint: { type: 'string' },
    pagePath: { type: 'string' },
    pageUrl: { type: 'string' },
    templatePath: { type: 'string' },
    page: buildOutputEntryPageMetaSchema,
  },
  required: ['outputRelname', 'filepath', 'kind', 'url', 'revision', 'bytes'],
  additionalProperties: false,
})

/** @satisfies {JSONSchema} */
export const buildOutputManifestSchema = /** @type {const} */ ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: BUILD_OUTPUT_MANIFEST_SCHEMA_ID,
  title: 'DomStack build output manifest',
  type: 'object',
  properties: {
    $schema: { const: BUILD_OUTPUT_MANIFEST_SCHEMA_ID },
    version: { type: 'string' },
    generatedAt: { type: 'string', format: 'date-time' },
    entries: {
      type: 'array',
      items: buildOutputEntrySchema,
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
export function getBuildOutputManifestSchemaId (version) {
  return `https://unpkg.com/@domstack/static@${version}/${BUILD_OUTPUT_MANIFEST_SCHEMA_PATH}`
}

/**
 * @typedef {FromSchema<typeof buildOutputKindSchema>} BuildOutputKind
 */

/**
 * @typedef {FromSchema<typeof buildOutputEntryPageMetaSchema>} BuildOutputEntryPageMeta
 */

/**
 * A build step writes these as it emits files. Reconciliation turns them into
 * revisioned manifest entries.
 *
 * @typedef {object} BuildOutputRecord
 * @property {string} outputRelname
 * @property {string} filepath
 * @property {BuildOutputKind} kind
 * @property {string} [url]
 * @property {string} [sourceRelname]
 * @property {string} [entryPoint]
 * @property {string} [pagePath]
 * @property {string} [pageUrl]
 * @property {string} [templatePath]
 * @property {BuildOutputEntryPageMeta} [page]
 */

/**
 * @typedef {FromSchema<typeof buildOutputEntrySchema>} BuildOutputEntry
 */

/**
 * @typedef {FromSchema<typeof buildOutputManifestSchema>} BuildOutputManifest
 */

/**
 * @typedef {object} BuildOutputManifestOptions
 * @property {string[]} [exclude]
 * @property {(entry: BuildOutputEntry) => boolean | Promise<boolean>} [includeOutput]
 * @property {string} [filename]
 */

const KIND_PRIORITY = new Map([
  ['page', 100],
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
 * @param {BuildOutputRecord[]} [params.records]
 * @param {BuildOutputEntry[]} [params.entries]
 * @param {BuildOutputManifestOptions} [params.options]
 * @returns {Promise<BuildOutputManifest>}
 */
export async function buildOutputManifest ({ dest, records = [], entries: existingEntries = [], options = {} }) {
  /** @type {Map<string, BuildOutputEntry>} */
  const entryMap = new Map()

  for (const entry of existingEntries) {
    setEntry(entryMap, normalizeExistingEntry({ dest, entry }))
  }

  for (const record of records) {
    const entry = await createEntry({ dest, record })
    setEntry(entryMap, entry)
  }

  entryMap.delete(toPosix(options.filename ?? DEFAULT_OUTPUT_MANIFEST_FILENAME))

  let finalEntries = Array.from(entryMap.values())
    .filter(entry => entry.revision)
    .sort((a, b) => a.url.localeCompare(b.url))

  finalEntries = applyExclude(finalEntries, options.exclude ?? [])

  if (options.includeOutput) {
    const included = []
    for (const entry of finalEntries) {
      if (await options.includeOutput(entry)) included.push(entry)
    }
    finalEntries = included
  }

  const version = createHash('sha256')
  for (const entry of finalEntries) {
    version.update(entry.url)
    version.update('\0')
    version.update(entry.revision ?? '')
    version.update('\0')
  }

  return {
    $schema: BUILD_OUTPUT_MANIFEST_SCHEMA_ID,
    version: version.digest('hex'),
    generatedAt: new Date().toISOString(),
    entries: finalEntries,
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
 * @param {BuildOutputKind} params.kind
 * @param {string} [params.url]
 * @param {string} [params.sourceRelname]
 * @param {string} [params.entryPoint]
 * @param {string} [params.pagePath]
 * @param {string} [params.pageUrl]
 * @param {string} [params.templatePath]
 * @param {BuildOutputEntryPageMeta} [params.page]
 * @returns {BuildOutputRecord}
 */
export function createOutputRecord ({
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
 * @returns {BuildOutputRecord[]}
 */
export function createCopiedOutputRecords ({ src, dest, report, kind }) {
  return extractCopiedFiles(report).map(copiedFile => {
    const filepath = resolve(copiedFile.output)
    return createOutputRecord({
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
 * @returns {BuildOutputKind}
 */
export function classifyEsbuildOutput ({ outputRelname, entryPoint, workerOutputRelnames }) {
  const ext = extname(outputRelname)

  if (ext === '.map') return 'sourcemap'
  if (workerOutputRelnames.has(outputRelname)) return 'worker'
  if (ext === '.css') return 'style'
  if (ext === '.js' && entryPoint) return 'script'
  return 'chunk'
}

// Manifest writing and options

/**
 * @param {string} dest
 * @param {BuildOutputManifest} outputManifest
 * @param {string} [filename]
 */
export async function writeOutputManifest (dest, outputManifest, filename = DEFAULT_OUTPUT_MANIFEST_FILENAME) {
  const manifestPath = resolve(dest, filename)
  assertInsideDest(dest, manifestPath)
  await writeFile(manifestPath, JSON.stringify(outputManifest, null, 2))
}

/**
 * @param {object} params
 * @param {string | undefined} params.globalVarsPath
 * @param {DomStackOpts | undefined} params.opts
 * @returns {Promise<BuildOutputManifestOptions>}
 */
export async function resolveOutputManifestOptions ({ globalVarsPath, opts }) {
  const outputManifestOpts = typeof opts?.outputManifest === 'object'
    ? opts.outputManifest
    : {}
  const buildManifestVars = await resolveVars({
    varsPath: globalVarsPath,
    key: 'buildManifest',
  })
  const includeOutput = typeof /** @type {{ includeOutput?: unknown }} */ (buildManifestVars).includeOutput === 'function'
    ? /** @type {(entry: BuildOutputEntry) => boolean | Promise<boolean>} */ (/** @type {{ includeOutput: unknown }} */ (buildManifestVars).includeOutput)
    : undefined

  /** @type {BuildOutputManifestOptions} */
  const options = {
    exclude: [
      ...((Array.isArray(outputManifestOpts.exclude) ? outputManifestOpts.exclude : [])),
      ...((Array.isArray(/** @type {{ exclude?: unknown }} */ (buildManifestVars).exclude) ? /** @type {string[]} */ (/** @type {{ exclude: unknown }} */ (buildManifestVars).exclude) : [])),
    ],
    filename: getOutputManifestFilename(opts),
  }

  if (includeOutput) options.includeOutput = includeOutput

  return options
}

/**
 * @param {DomStackOpts | undefined} opts
 */
export function shouldWriteOutputManifest (opts) {
  if (opts?.outputManifest === false) return false
  if (typeof opts?.outputManifest === 'object' && opts.outputManifest.write === false) return false
  return true
}

/**
 * @param {DomStackOpts | undefined} opts
 */
export function getOutputManifestFilename (opts) {
  return typeof opts?.outputManifest === 'object' && typeof opts.outputManifest.filename === 'string'
    ? opts.outputManifest.filename
    : DEFAULT_OUTPUT_MANIFEST_FILENAME
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
 * @param {BuildOutputRecord} params.record
 * @returns {Promise<BuildOutputEntry | null>}
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
 * @param {BuildOutputEntry} params.entry
 * @returns {BuildOutputEntry}
 */
function normalizeExistingEntry ({ dest, entry }) {
  const filepath = resolve(entry.filepath)
  assertInsideDest(dest, filepath)

  return {
    ...entry,
    outputRelname: toPosix(entry.outputRelname),
    filepath,
    url: entry.url ?? outputRelnameToUrl(entry.outputRelname),
  }
}

/**
 * @param {Map<string, BuildOutputEntry>} entries
 * @param {BuildOutputEntry | null} entry
 */
function setEntry (entries, entry) {
  if (!entry) return
  const existing = entries.get(entry.outputRelname)
  if (!existing || priority(entry.kind) >= priority(existing.kind)) {
    entries.set(entry.outputRelname, entry)
  }
}

/**
 * @param {BuildOutputEntry[]} entries
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
  if (typeof version !== 'string') throw new Error('Unable to resolve package version for output manifest schema')
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
 * @param {BuildOutputKind} kind
 */
function priority (kind) {
  return KIND_PRIORITY.get(kind) ?? -1
}
