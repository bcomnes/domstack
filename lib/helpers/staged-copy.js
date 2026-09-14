/**
 * @import { OutputRegistry } from '../output-registry.js'
 * @import { NormalizedOptions } from 'cpx2'
 */
import normalizeOptions from 'cpx2/lib/utils/normalize-options.js'
import applyAction from 'cpx2/lib/utils/apply-action.js'
import copy from 'cpx2/lib/utils/copy-file.js'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createCopiedDomstackManifestRecords } from './cpx2-report.js'

/**
 * Keep cpx's matching and mapping semantics, but inventory before writing so
 * case aliases and file/directory aliases cannot collapse in the staging tree.
 * These cpx internals are intentionally confined to this adapter.
 * @param {string} source
 * @param {string} src
 * @param {string} dest
 * @param {'static' | 'copy'} kind
 * @param {OutputRegistry} registry
 * @param {string[]} [ignore]
 * @param {string} [ownerPrefix] - Identity of this configured copy-root occurrence.
 */
export async function stagedCopy (source, src, dest, kind, registry, ignore = [], ownerPrefix = '') {
  const options = normalizeOptions(source, dest, { ignore })
  const sources = /** @type {string[]} */ (await applyAction(options.source, options, path => path))
  const report = {
    cleaned: [],
    copied: sources.map(source => ({ source, output: options.toDestination(source), skipped: false })),
    options,
  }
  const outputs = createCopiedDomstackManifestRecords({ src, dest, report, kind })
  registry.claimRecords(outputs, ownerPrefix)
  await mkdir(dest, { recursive: true })
  const stage = await mkdtemp(join(dest, '.domstack-copy-'))
  try {
    for (const [index, entry] of report.copied.entries()) {
      const stagedPath = join(stage, String(index))
      await copy(entry.source, stagedPath, options)
    }
    for (const [index, output] of outputs.entries()) {
      const target = resolve(dest, output.outputRelname)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(join(stage, String(index)), target)
    }
    return { report, outputs }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

/** Rebuild the mapper as well as the known report paths after full-watch staging.
 * @param {object} value
 * @param {string} dest
 */
export function remapCopyReport (value, dest) {
  if (!('options' in value)) return
  const report = /** @type {{ options: NormalizedOptions, copied: { source: string, output: string }[] }} */ (value)
  report.options = normalizeOptions(report.options.source, dest, { ignore: report.options.ignore ?? [] })
  for (const entry of report.copied) entry.output = report.options.toDestination(entry.source)
}
