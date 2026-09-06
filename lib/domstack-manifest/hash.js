/**
 * @import { DomstackManifestEntry } from './schema.js'
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { stableJsonStringify } from '../helpers/stable-json-stringify.js'

/**
 * Hash only the fields that affect static cache membership and content. Source
 * metadata is intentionally ignored so debug/build-origin changes do not churn
 * PWA cache names.
 *
 * @param {{ update: (value: string) => unknown }} hash
 * @param {DomstackManifestEntry} entry
 */
export function updateManifestVersionHash (hash, entry) {
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
}

/**
 * @param {{ update: (value: string) => unknown }} hash
 * @param {unknown} value
 */
export function updateManifestVersionValue (hash, value) {
  const serializedValue = stableJsonStringify(value)
  hash.update(serializedValue ?? '')
  hash.update('\0')
}

/**
 * @param {string} filepath
 */
export async function hashFileDigest (filepath) {
  const contents = await readFile(filepath)
  const digest = createHash('sha256').update(contents).digest()
  return {
    hex: digest.toString('hex'),
    integrity: `sha256-${digest.toString('base64')}`,
  }
}

/**
 * @param {string | null} revision
 * @returns {string | undefined}
 */
export function revisionToIntegrity (revision) {
  if (!revision || !/^[a-f0-9]{64}$/i.test(revision)) return undefined
  return `sha256-${Buffer.from(revision, 'hex').toString('base64')}`
}
