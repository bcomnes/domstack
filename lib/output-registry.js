/**
 * @import { DomstackManifestRecord } from './domstack-manifest/index.js'
 * @import { DomStackOutputConflictErrorClaim } from './helpers/domstack-error.js'
 */

import { join, posix } from 'node:path'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { DomStackOutputConflictError } from './helpers/domstack-error.js'
import { toPosix } from './helpers/path.js'

/**
 * @typedef OutputOwner
 * @property {string} id - Stable identity used to replace an owner's outputs in watch mode.
 * @property {string} type - Human-readable producer type.
 * @property {string} path - Human-readable source or build-step path.
 */

/**
 * @typedef OutputClaim
 * @property {string} outputRelname
 * @property {OutputOwner} owner
 */

/**
 * Track destination-relative output ownership for one successful build state.
 */
export class OutputRegistry {
  /** @type {Map<string, OutputClaim>} */
  #claims = new Map()
  #caseInsensitive

  /**
   * @param {OutputClaim[]} [previousClaims]
   * @param {{ replaceOwnerIds?: Iterable<string>, caseInsensitive?: boolean }} [options]
   */
  constructor (previousClaims = [], options = {}) {
    this.#caseInsensitive = options.caseInsensitive ?? false
    const replaceOwnerIds = new Set(options.replaceOwnerIds ?? [])
    for (const claim of previousClaims) {
      if (replaceOwnerIds.has(claim.owner.id)) continue
      this.#claims.set(this.#key(claim.outputRelname), structuredClone(claim))
    }
  }

  /**
   * @param {string} outputRelname
   * @param {OutputOwner} owner
   */
  claim (outputRelname, owner) {
    const normalized = normalizeOutputRelname(outputRelname)
    const conflict = this.#findConflict(normalized)
    if (conflict) throw createConflictError(normalized, conflict.owner, owner)
    this.#claims.set(this.#key(normalized), { outputRelname: normalized, owner: { ...owner } })
  }

  /** @param {string} path */
  #key (path) {
    const normalized = normalizeOutputRelname(path)
    return this.#caseInsensitive ? normalized.normalize('NFC').toLowerCase() : normalized
  }

  /** @param {Iterable<string>} ownerIds */
  releaseOwnerIds (ownerIds) {
    const released = new Set(ownerIds)
    for (const [outputRelname, claim] of this.#claims) {
      if (released.has(claim.owner.id)) this.#claims.delete(outputRelname)
    }
  }

  /**
   * @param {DomstackManifestRecord[]} records
   * @param {string} [ownerPrefix]
   */
  claimRecords (records, ownerPrefix = '') {
    const seen = new Set()
    for (const record of records) {
      // Reporting the same record twice is not a second write. Dynamic writers
      // use claim() directly, where repeated outputs always conflict.
      const key = JSON.stringify(record)
      if (seen.has(key)) continue
      seen.add(key)
      const owner = outputOwnerForRecord(record)
      this.claim(record.outputRelname, { ...owner, id: `${ownerPrefix}${owner.id}` })
    }
  }

  /** @returns {OutputClaim[]} */
  snapshot () {
    return Array.from(this.#claims.values(), claim => structuredClone(claim))
  }

  /**
   * @param {string} outputRelname
   * @returns {OutputClaim | undefined}
   */
  #findConflict (outputRelname) {
    outputRelname = this.#key(outputRelname)
    const exact = this.#claims.get(outputRelname)
    if (exact) return exact

    for (const [key, claim] of this.#claims) {
      if (outputRelname.startsWith(`${key}/`) || key.startsWith(`${outputRelname}/`)) {
        return claim
      }
    }
  }
}

/** Probe the destination volume rather than assuming case behavior from the OS.
 * @param {string} dest
 */
export async function isCaseInsensitiveDest (dest) {
  await mkdir(dest, { recursive: true })
  const probe = await mkdtemp(join(dest, '.domstack-case-'))
  try {
    await writeFile(join(probe, 'probe'), '')
    try {
      await access(join(probe, 'PROBE'))
      return true
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
      return false
    }
  } finally {
    await rm(probe, { recursive: true, force: true })
  }
}

/**
 * @param {DomstackManifestRecord} record
 * @returns {OutputOwner}
 */
export function outputOwnerForRecord (record) {
  const source = record.sourceRelname ?? record.entryPoint
  const path = source ?? describeBuildStep(record.kind)
  return {
    id: `${record.kind}:${source ?? record.outputRelname}`,
    type: record.kind,
    path,
  }
}

/**
 * @param {string} outputRelname
 * @returns {string}
 */
export function normalizeOutputRelname (outputRelname) {
  const normalized = posix.normalize(toPosix(outputRelname).replaceAll('\\', '/'))
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error(`Output path must be destination-relative: ${outputRelname}`)
  }
  return normalized
}

/**
 * @param {string} outputPath
 * @param {OutputOwner} a
 * @param {OutputOwner} b
 */
function createConflictError (outputPath, a, b) {
  const first = /** @type {DomStackOutputConflictErrorClaim} */ ({ type: a.type, path: a.path })
  const second = /** @type {DomStackOutputConflictErrorClaim} */ ({ type: b.type, path: b.path })
  return new DomStackOutputConflictError(
    `Output path conflict: ${outputPath} is produced by both ${first.path} and ${second.path}.`,
    { outputPath, a: first, b: second }
  )
}

/** @param {DomstackManifestRecord['kind']} kind */
function describeBuildStep (kind) {
  if (kind === 'metadata') return 'domstack esbuild metadata'
  if (kind === 'service-worker') return 'service worker build'
  return `${kind} build step`
}
