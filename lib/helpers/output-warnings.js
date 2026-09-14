/**
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 * @import { DomStackWarning } from './domstack-warning.js'
 */
import { resolve } from 'node:path'

/**
 * Report duplicate destinations observed in build reports. This does not reserve
 * paths or control writes; watch phases can only report the outputs they see.
 * @param {DomstackManifestRecord[]} outputs
 * @returns {DomStackWarning[]}
 */
export function outputWarnings (outputs) {
  const destinations = new Map()
  const warnings = /** @type {DomStackWarning[]} */ ([])
  for (const output of outputs) {
    const path = resolve(output.filepath)
    const previous = destinations.get(path)
    if (previous) {
      warnings.push({
        code: 'DOM_STACK_WARNING_DUPLICATE_OUTPUT',
        message: `Duplicate output "${output.outputRelname}": ${previous.sourceRelname ?? previous.kind} (${previous.kind}) and ${output.sourceRelname ?? output.kind} (${output.kind}) write the same destination; output may be overwritten.`,
      })
    } else destinations.set(path, output)
  }
  return warnings
}
