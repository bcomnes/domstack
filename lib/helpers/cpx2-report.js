/**
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 */

import { relative, resolve } from 'node:path'
import { createDomstackManifestRecord } from '../domstack-manifest/index.js'
import { toPosix } from './path.js'

/**
 * Convert a cpx2 report into domstack manifest output records.
 *
 * @param {object} params
 * @param {string} params.src - Source directory used to make copied source paths relative.
 * @param {string} params.dest - Destination directory that received copied files.
 * @param {unknown} params.report - Raw cpx2 report returned by `copy`.
 * @param {'static'|'copy'} params.kind - Manifest kind to assign to copied outputs.
 * @returns {DomstackManifestRecord[]}
 */
export function createCopiedDomstackManifestRecords ({ src, dest, report, kind }) {
  const records = []

  for (const copiedFile of extractCopiedFiles(report)) {
    const filepath = resolve(copiedFile.output)
    records.push(createDomstackManifestRecord({
      dest,
      filepath,
      kind,
      sourceRelname: copiedFile.source ? toPosix(relative(src, resolve(copiedFile.source))) : undefined,
    }))
  }

  return records
}

/**
 * @typedef {{ source?: string, output: string }} Cpx2CopiedFile
 */

/**
 * @param {unknown} report
 * @returns {Cpx2CopiedFile[]}
 */
function extractCopiedFiles (report) {
  /** @type {Cpx2CopiedFile[]} */
  const copied = []

  const visit = (/** @type {unknown} */ value) => {
    if (!value || typeof value !== 'object') return

    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }

    const maybeCopied = /** @type {{ source?: unknown, output?: unknown }} */ (value)
    if (typeof maybeCopied.output === 'string') {
      /** @type {Cpx2CopiedFile} */
      const copiedFile = { output: maybeCopied.output }
      if (typeof maybeCopied.source === 'string') copiedFile.source = maybeCopied.source
      copied.push(copiedFile)
    }

    for (const child of Object.values(value)) visit(child)
  }

  visit(report)
  return copied
}
