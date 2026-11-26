import { readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { containsPath, resolveCanonicalPath } from './path.js'

// Exact matches keep deployment directories such as /var/www/site usable.
// https://sources.debian.org/src/safe-rm/0.12-2%2Bdeb9u1/safe-rm/
const unixDirectories = new Set([
  '/bin', '/boot', '/dev', '/etc', '/home', '/initrd', '/lib', '/lib32', '/lib64',
  '/media', '/mnt', '/opt', '/proc', '/root', '/run', '/sbin', '/srv', '/sys',
  '/tmp', '/usr', '/usr/bin', '/usr/include',
  '/usr/lib', '/usr/local', '/usr/local/bin', '/usr/local/include', '/usr/local/sbin',
  '/usr/local/share', '/usr/sbin', '/usr/share', '/usr/src', '/var', '/var/cache',
  '/var/lib', '/var/log', '/var/run', '/var/spool', '/var/tmp'
])
const macDirectories = new Set([
  '/Applications', '/Library', '/System', '/Users', '/Volumes', '/private',
  '/private/etc', '/private/tmp', '/private/var', '/private/var/log',
  '/private/var/run', '/private/var/spool', '/private/var/tmp'
])

/** @param {string} destination */
function checkSystemDirectory (destination) {
  const path = resolve(destination)
  if (path === parse(path).root) {
    throw new Error(`Refusing to clean filesystem root: ${destination}`)
  }
  if (unixDirectories.has(path) || (process.platform === 'darwin' &&
      (macDirectories.has(path) || containsPath('/System', path)))) {
    throw new Error(`Refusing to clean protected directory: ${destination}`)
  }
}

/** @param {string} destination */
async function checkProtectedDirectory (destination) {
  checkSystemDirectory(destination)
  const canonical = await resolveCanonicalPath(destination)
  checkSystemDirectory(canonical)
  const protectedPaths = [homedir(), tmpdir()]
  if (process.platform === 'win32') {
    const { SystemRoot, ProgramData, ProgramFiles, 'ProgramFiles(x86)': programFilesX86, PUBLIC } = process.env
    for (const path of [SystemRoot, ProgramData, ProgramFiles, programFilesX86, PUBLIC]) {
      if (path) protectedPaths.push(path)
    }
  }
  const protectedDirectories = await Promise.all(protectedPaths.map(resolveCanonicalPath))
  if (protectedDirectories.some(path => containsPath(canonical, path))) {
    throw new Error(`Refusing to clean protected directory: ${destination}`)
  }
  return canonical
}

/** @param {string} source @param {string} destination @param {string[]} copyRoots */
export async function checkCleanupTarget (source, destination, copyRoots) {
  destination = await checkProtectedDirectory(destination)
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
  checkSystemDirectory(claimedDestination)
  const canonicalDestination = await checkProtectedDirectory(dest)
  if (canonicalDestination !== claimedDestination) {
    throw new Error('The requested destination changed before cleanup')
  }
  const entries = await readdir(claimedDestination).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) await rm(join(claimedDestination, entry), { recursive: true, force: true })
}
