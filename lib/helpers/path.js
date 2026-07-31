import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Convert a path-like string to POSIX separators for URLs and manifest relnames.
 *
 * @param {string} value
 */
export function toPosix (value) {
  return value.split(sep).join('/')
}

/**
 * Assert that a filepath resolves inside the build destination.
 *
 * @param {string} dest
 * @param {string} filepath
 * @param {string} [message]
 */
export function assertInsideDest (dest, filepath, message = `Output path escapes dest: ${filepath}`) {
  const absDest = resolve(dest)
  const absFilepath = resolve(filepath)
  const rel = relative(absDest, absFilepath)
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error(message)
  }
}
