import { readdir, rm } from 'node:fs/promises'
import { join, parse, resolve } from 'node:path'
import { containsPath, resolveCanonicalPath } from './path.js'

/** @param {string} destination */
function rejectFilesystemRoot (destination) {
  const path = resolve(destination)
  if (path === parse(path).root) {
    throw new Error(`Refusing to clean filesystem root: ${destination}`)
  }
}

/** @param {string} source @param {string} destination @param {string[]} copyRoots */
export async function checkCleanupTarget (source, destination, copyRoots) {
  rejectFilesystemRoot(destination)
  destination = await resolveCanonicalPath(destination)
  rejectFilesystemRoot(destination)
  const inputs = await Promise.all([source, process.cwd(), ...copyRoots].map(resolveCanonicalPath))
  if (inputs.some(path => containsPath(destination, path))) {
    throw new Error(`Refusing to clean unsafe build destination: ${destination}`)
  }
}

/**
 * Empty the claimed destination, preserving its inode, permissions and symlink aliases.
 * Recursive removal unlinks child symlinks without following their targets.
 * @param {string} dest
 * @param {string} claimedDestination
 */
export async function cleanDest (dest, claimedDestination) {
  // Guard the destructive helper itself, even if its caller skips validation.
  rejectFilesystemRoot(dest)
  rejectFilesystemRoot(claimedDestination)
  const canonicalDestination = await resolveCanonicalPath(dest)
  rejectFilesystemRoot(canonicalDestination)
  if (canonicalDestination !== claimedDestination) {
    throw new Error('The requested destination changed before cleanup')
  }
  const entries = await readdir(claimedDestination).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) await rm(join(claimedDestination, entry), { recursive: true, force: true })
}
