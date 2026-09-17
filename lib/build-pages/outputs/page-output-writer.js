/**
 * @import { Stats } from 'node:fs'
 * @import { PageData } from '../page/page-data.js'
 *
 * @typedef {Map<string, { hash: string, metadata: string }>} PageOutputCache
 */
import { createHash } from 'node:crypto'
import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { assertInsideDest, toPosix } from '../../helpers/path.js'
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
export function resolvePageOutputPath (dest, pageFilePath, outputName) {
  if (typeof outputName !== 'string' || !outputName.trim()) {
    throw new TypeError('Page outputName must be a non-empty file path')
  }
  const name = outputName.replaceAll('\\', '/')
  if (outputName.startsWith('\\') || name.startsWith('//') || /^[a-z]:/i.test(name)) {
    throw new Error(`Page outputName must not be a drive or UNC path: ${outputName}`)
  }
  const parts = name.split('/')
  if (!parts.at(-1) || ['.', '..'].includes(parts.at(-1) ?? '')) {
    throw new Error(`Page outputName must name a file: ${outputName}`)
  }
  for (const part of parts) {
    if (!part || part === '.' || part === '..') continue
    // Reject Windows aliases and special files even when building on POSIX.
    if (/[<>:"|?*]/u.test(part) || Array.from(part).some(character => character.charCodeAt(0) < 32) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) {
      throw new Error(`Page outputName contains an invalid file path component: ${outputName}`)
    }
  }
  const filepath = name.startsWith('/')
    ? resolve(dest, name.slice(1))
    : resolve(dirname(pageFilePath), name)
  const relname = relative(resolve(dest), filepath)
  const message = `Page outputName escapes dest or names its directory: ${outputName}`
  assertInsideDest(dest, filepath, message)
  if (!relname) throw new Error(message)
  return { filepath, outputRelname: toPosix(relname) }
}

/**
 * Check existing components, including the leaf, without following symlinks.
 * This is not a defense against concurrent external filesystem mutations.
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
    if (info.isSymbolicLink()) throw new Error(`Page output path contains a symlink: ${current}`)
    const leaf = index === components.length - 1
    if (leaf ? !info.isFile() : !info.isDirectory()) {
      throw new Error(`Page output path is not a ${leaf ? 'file' : 'directory'}: ${current}`)
    }
    if (leaf) return info
  }
}

/**
 * Write sidecars directly, retaining ownership records even for unchanged bytes.
 *
 * @param {object} params
 * @param {string} params.dest
 * @param {string} params.pageFilePath
 * @param {Pick<PageData<any, any, any, any>, 'pageInfo' | 'outputRecords'>} params.page
 * @param {Iterable<{outputName: string, content: string}> | AsyncIterable<{outputName: string, content: string}>} params.pageOutputs
 * @param {PageOutputCache | undefined} [params.outputCache]
 */
export async function writePageOutputs ({ dest, pageFilePath, page, pageOutputs, outputCache }) {
  const { pageInfo, outputRecords } = page
  for await (const output of pageOutputs) {
    if (typeof output.content !== 'string') throw new TypeError('Page output content must be a string')
    const { filepath, outputRelname } = resolvePageOutputPath(dest, pageFilePath, output.outputName)
    const info = await assertWritablePath(dest, filepath)
    const hash = outputCache ? createHash('sha256').update(output.content, 'utf8').digest('hex') : undefined
    const cached = outputCache?.get(filepath)
    const unchanged = cached && cached.hash === hash && info && cached.metadata === fileMetadata(info)
    if (!unchanged) {
      outputCache?.delete(filepath)
      await mkdir(dirname(filepath), { recursive: true })
      await writeFile(filepath, output.content)
    }
    const record = {
      ...createDomstackManifestRecord({
        dest,
        filepath,
        outputRelname,
        kind: 'page-output',
        sourceRelname: pageInfo.pageFile.relname,
        pagePath: pageInfo.path,
        pageUrl: pageInfo.url,
      }),
      pagePath: pageInfo.path,
    }
    outputRecords.push(record)
    if (!unchanged && outputCache && hash) {
      outputCache.set(filepath, { hash, metadata: fileMetadata(await lstat(filepath)) })
    }
  }
  return outputRecords
}

/**
 * Best-effort detection of replacement or external edits, even if mtime is restored.
 * Reuses the path validation stat; never rereads destination content.
 * @param {Stats} info
 */
function fileMetadata (info) {
  return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':')
}
