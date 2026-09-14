/**
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 */
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Validate every stale removal and sidecar destination before cleanup or writing.
 * The root may resolve through symlinks, but no component below it may do so.
 * Only intermediate regular files in this transaction's removal set may block a
 * new destination. This preflight does not guard against external filesystem races.
 *
 * @param {string} dest
 * @param {DomstackManifestRecord[]} outputs
 * @param {Iterable<string>} [removablePaths] Destination-relative stale claims.
 * @returns {Promise<Set<string>>} Unchanged page-additional outputRelnames only.
 */
export async function prepareAdditionalOutputPromotion (dest, outputs, removablePaths = []) {
  const sidecars = outputs.filter(output => output.kind === 'page-additional')
  const removals = [...removablePaths]
  const unchanged = new Set()
  if (sidecars.length === 0 && removals.length === 0) return unchanged
  let root = resolve(dest)
  try { root = await realpath(root) } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
  }
  const removable = new Set(removals.map(name => resolve(root, name)))
  /** @param {string} name @param {boolean} allowRemoval */
  async function inspect (name, allowRemoval) {
    const target = resolve(root, name)
    const rel = relative(root, target)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`Additional output path escapes dest: ${name}`)
    }
    let current = root
    const components = rel.split(sep)
    for (const [index, component] of components.entries()) {
      current = resolve(current, component)
      let info
      try { info = await lstat(current) } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
        return { target, comparable: false }
      }
      if (info.isSymbolicLink()) throw new Error(`Additional output path contains a symlink: ${name}`)
      if (index < components.length - 1 && !info.isDirectory()) {
        if (allowRemoval && info.isFile() && removable.has(current)) return { target, comparable: false }
        throw Object.assign(new Error(`Output path has a non-directory ancestor: ${name}`), { code: 'ENOTDIR' })
      }
      if (index === components.length - 1) return { target, comparable: !info.isDirectory() && !removable.has(target) }
    }
    return { target, comparable: false }
  }
  // Validate the entire removal set even when no sidecars are being emitted.
  for (const name of removals) await inspect(name, false)
  const targets = []
  for (const output of sidecars) targets.push({ output, ...await inspect(output.outputRelname, true) })
  for (const { output, target, comparable } of targets) {
    // Missing staged sources are errors, not evidence that a destination changed.
    const source = await readFile(output.filepath)
    if (!comparable) continue
    try {
      if (source.equals(await readFile(target))) unchanged.add(output.outputRelname)
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
    }
  }
  return unchanged
}
