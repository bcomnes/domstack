import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Convert a path-like string to POSIX separators for URLs and manifest relnames.
 *
 * @param {string} value
 */
export function toPosix (value) {
  return value.split(sep).join('/')
}

/**
 * Check whether a path is the directory itself or one of its descendants, without following symlinks.
 *
 * @param {string} directory
 * @param {string} filepath
 */
export function containsPath (directory, filepath) {
  const rel = relative(directory, filepath)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

/**
 * Assert that a filepath resolves inside the build destination.
 *
 * @param {string} dest
 * @param {string} filepath
 * @param {string} [message]
 */
export function assertInsideDest (dest, filepath, message = `Output path escapes dest: ${filepath}`) {
  if (!containsPath(dest, filepath)) throw new Error(message)
}

/**
 * Resolve symlinks in the existing part of a path, preserving any missing trailing components.
 *
 * @param {string} filepath
 */
export async function resolveCanonicalPath (filepath) {
  let path = resolve(filepath)
  const missing = []
  for (;;) {
    try {
      return join(await realpath(path), ...missing.reverse())
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
      // A dangling symlink is an existing entry without a canonical target.
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
