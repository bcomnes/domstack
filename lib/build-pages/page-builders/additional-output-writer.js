/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { DomstackManifestRecord } from '../../domstack-manifest/index.js'
 * @import { AdditionalOutputProvenance } from '../additional-outputs.js'
 */
import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createDomstackManifestRecord } from '../../domstack-manifest/index.js'

/**
 * Resolve sidecar names independently of legacy page/template path semantics.
 * Backslashes are separators on every platform; only a single leading forward
 * slash means destination-root relative (drive paths and UNC paths are invalid).
 *
 * @param {string} dest
 * @param {string} pageFilePath
 * @param {string} outputName
 */
export function resolveAdditionalOutputPath (dest, pageFilePath, outputName) {
  if (typeof outputName !== 'string' || !outputName.trim()) {
    throw new TypeError('Additional outputName must be a non-empty file path')
  }
  const name = outputName.replaceAll('\\', '/')
  if (outputName.startsWith('\\') || name.startsWith('//') || /^[a-z]:/i.test(name)) {
    throw new Error(`Additional outputName must not be a drive or UNC path: ${outputName}`)
  }
  const parts = name.split('/')
  if (!parts.at(-1) || ['.', '..'].includes(parts.at(-1) ?? '')) {
    throw new Error(`Additional outputName must name a file: ${outputName}`)
  }
  for (const part of parts) {
    if (!part || part === '.' || part === '..') continue
    // Reject Windows aliases and special files even when building on POSIX.
    if (/[<>:"|?*]/u.test(part) || Array.from(part).some(character => character.charCodeAt(0) < 32) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) {
      throw new Error(`Additional outputName contains an invalid file path component: ${outputName}`)
    }
  }
  const filepath = name.startsWith('/')
    ? resolve(dest, name.slice(1))
    : resolve(dirname(pageFilePath), name)
  const relname = relative(resolve(dest), filepath)
  if (!relname || relname === '..' || relname.startsWith(`..${sep}`) || isAbsolute(relname)) {
    throw new Error(`Additional outputName escapes dest or names its directory: ${outputName}`)
  }
  return { filepath, outputRelname: relname.split(sep).join('/') }
}

/**
 * Check existing components, including the leaf, without following symlinks.
 * The caller owns a private stage; this is not a defense against concurrent
 * hostile filesystem mutations or a substitute for final promotion checks.
 *
 * @param {string} dest
 * @param {string} filepath
 */
async function assertWritablePath (dest, filepath) {
  let current = resolve(dest)
  const components = relative(current, filepath).split(sep)
  for (let index = -1; index < components.length; index++) {
    const component = components[index]
    if (component !== undefined) current = resolve(current, component)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') continue
      throw error
    }
    if (info.isSymbolicLink()) throw new Error(`Additional output path contains a symlink: ${current}`)
    const leaf = index === components.length - 1
    if (leaf ? !info.isFile() : !info.isDirectory()) {
      throw new Error(`Additional output path is not a ${leaf ? 'file' : 'directory'}: ${current}`)
    }
  }
}

/**
 * Write only into the supplied build stage; ownership and promotion belong to
 * build-pages. Extra hook provenance does not change the owning source page.
 *
 * @param {object} params
 * @param {string} params.dest
 * @param {string} params.pageFilePath
 * @param {PageInfo} params.pageInfo
 * @param {Array<{outputName: string, content: string, provenance?: AdditionalOutputProvenance}>} params.additionalOutputs
 * @param {(outputRelname: string, provenance?: AdditionalOutputProvenance) => void} [params.claimOutput]
 * @returns {Promise<DomstackManifestRecord[]>}
 */
export async function writeAdditionalOutputs ({ dest, pageFilePath, pageInfo, additionalOutputs, claimOutput }) {
  const planned = additionalOutputs.map(output => {
    if (typeof output.content !== 'string') throw new TypeError('Additional output content must be a string')
    return { ...resolveAdditionalOutputPath(dest, pageFilePath, output.outputName), content: output.content, provenance: output.provenance }
  })
  // Reserve the whole batch before touching the stage, including duplicate records.
  for (const output of planned) claimOutput?.(output.outputRelname, output.provenance)
  for (const output of planned) await assertWritablePath(dest, output.filepath)
  const records = []
  for (const { filepath, outputRelname, content } of planned) {
    await mkdir(dirname(filepath), { recursive: true })
    await writeFile(filepath, content)
    records.push({
      ...createDomstackManifestRecord({
        dest,
        filepath,
        outputRelname,
        kind: 'page-additional',
        sourceRelname: pageInfo.pageFile.relname,
        pagePath: pageInfo.path,
        pageUrl: pageInfo.url,
      }),
      pagePath: pageInfo.path,
    })
  }
  return records
}
