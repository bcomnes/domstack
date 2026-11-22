/** @import { FileHandle } from 'node:fs/promises' */

import { createHash } from 'node:crypto'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)

/** @typedef {{ destination: string, release: () => Promise<void> }} DestinationClaim */

export class DestinationConflictError extends Error {
  code = 'DOMSTACK_DESTINATION_IN_USE'

  /** @param {string} destination */
  constructor (destination) {
    super(`Destination is in use by another DOMStack build or watcher: ${destination}`)
    this.name = 'DestinationConflictError'
  }
}

/** Resolve symlink aliases even when some trailing path components do not exist yet. @param {string} path */
export async function canonicalBuildPath (path) {
  path = resolve(path)
  const missing = []
  for (;;) {
    try {
      return join(await realpath(path), ...missing.reverse())
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
      // A dangling symlink has no canonical target to claim. Do not treat it
      // like a missing path component that a build can create later.
      const entry = await lstat(path).catch(error => {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
      })
      if (entry) throw error
      const parent = dirname(path)
      if (parent === path) throw error
      missing.push(basename(path))
      path = parent
    }
  }
}

/** @param {string} path */
function lockKey (path) {
  // Conservative on platforms where a volume may fold case or Unicode.
  return process.platform === 'darwin' || process.platform === 'win32'
    ? path.normalize('NFC').toLowerCase()
    : path
}

/** @param {string} path */
function * ancestors (path) {
  yield path
  while (dirname(path) !== path) {
    path = dirname(path)
    yield path
  }
}

/** @param {FileHandle[]} handles */
async function closeHandles (handles) {
  const closed = await Promise.allSettled(handles.reverse().map(handle => handle.close()))
  const errors = closed.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  if (errors.length > 0) throw new AggregateError(errors, 'Could not release DOMStack destination locks')
}

/**
 * Claim this destination exclusively and each ancestor in shared mode.
 * Acquire root first; a failed acquisition closes all partial locks before returning.
 * Lock files are stable inodes and must never be unlinked while processes may use them.
 * @param {string} path
 * @param {string} [directory]
 * @returns {Promise<DestinationClaim>}
 */
export async function claimDestination (path, directory = join(tmpdir(), `domstack-output-locks-${process.getuid?.() ?? 'user'}`)) {
  const destination = await canonicalBuildPath(path)
  const namespace = await canonicalBuildPath(directory)
  const destinationKey = lockKey(destination)
  const destinationAncestors = Array.from(ancestors(destination), lockKey)
  const namespaceAncestors = Array.from(ancestors(namespace), lockKey)
  if (destinationAncestors.includes(lockKey(namespace)) || namespaceAncestors.includes(destinationKey)) {
    throw new Error(`Build destination overlaps the DOMStack lock directory: ${destination}`)
  }
  await mkdir(namespace, { recursive: true, mode: 0o700 })
  const stat = await lstat(namespace)
  const uid = process.getuid?.()
  if (!stat.isDirectory() || (uid !== undefined && (stat.uid !== uid || (stat.mode & 0o077) !== 0))) {
    throw new Error(`DOMStack lock directory must be private: ${namespace}`)
  }

  const { tryLock } = /** @type {{ tryLock: (fd: number, options: { shared: boolean }) => boolean }} */ (require('fs-native-extensions'))
  /** @type {FileHandle[]} */
  const handles = []
  try {
    for (const key of destinationAncestors.reverse()) {
      const name = createHash('sha256').update(key).digest('hex')
      const handle = await open(join(namespace, name), 'a+', 0o600)
      handles.push(handle)
      if (!tryLock(handle.fd, { shared: key !== destinationKey })) {
        throw new DestinationConflictError(destination)
      }
    }
  } catch (error) {
    try {
      await closeHandles(handles)
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Could not acquire DOMStack destination locks')
    }
    throw error
  }

  /** @type {Promise<void> | undefined} */
  let release
  return { destination, release: () => (release ??= closeHandles(handles)) }
}
