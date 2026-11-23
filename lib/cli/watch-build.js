/**
 * @import { CliValues } from './args.js'
 * @import { DomStackOpts } from '../builder.js'
 */

import { createSessionRegistry } from '@domstack/sync'
import { readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { builder } from '../builder.js'
import { containsPath, resolveCanonicalPath } from '../helpers/path.js'
import { requestWatchRebuild, requestWatchStop, WatchControlError } from '../watch/control.js'

// Source and destination select the owner; these options would change its output.
const outputFlags = ['copy', 'drafts', 'ignore', 'noEsbuildMeta', 'domstackManifest']

/** @param {string} src @param {string} destination */
export async function findMatchingWatch (src, destination) {
  const source = await resolveCanonicalPath(src)
  const sessions = await createSessionRegistry().list().catch(error => {
    throw new WatchControlError('Could not discover the destination owner', { cause: error })
  })
  const matches = sessions.filter(session => session.kind === 'domstack-watch' &&
    session.source === source && session.destination === destination)
  if (matches.length > 1) throw new WatchControlError('Multiple watch sessions matched the claimed destination')
  return matches[0] ?? null
}

/** @param {string} src @param {string} destination @param {CliValues} options */
export async function delegateWatchBuild (src, destination, options) {
  const session = await findMatchingWatch(src, destination)
  if (!session) return false
  const supplied = outputFlags.filter(flag => options[flag] !== undefined && options[flag] !== false)
  if (supplied.length > 0) {
    throw new WatchControlError(`Cannot delegate with ${supplied.map(flag => `--${flag}`).join(', ')}; use --replace-watch to stop the watcher and apply different build options`)
  }
  console.log(`Rebuilding via active watch session ${session.id} (watch mode)`)
  await requestWatchRebuild(session.id)
  console.log('Watch rebuild succeeded')
  return true
}

/** @param {string} source @param {string} destination @param {string[]} copyRoots */
async function checkCleanupTarget (source, destination, copyRoots) {
  const inputs = await Promise.all([source, process.cwd(), ...copyRoots].map(resolveCanonicalPath))
  if (destination === dirname(destination) || inputs.some(path => containsPath(destination, path))) {
    throw new WatchControlError(`Refusing to clean unsafe watch destination: ${destination}`)
  }
}

/** @param {string} src @param {string} dest @param {string} claimedDestination @param {DomStackOpts} options */
export async function replaceWatchBuild (src, dest, claimedDestination, options) {
  const session = await findMatchingWatch(src, claimedDestination)
  if (!session) return null
  const checkDestination = async () => {
    if (await resolveCanonicalPath(dest) !== claimedDestination) {
      throw new WatchControlError('The requested destination changed while replacing the watch session')
    }
    await checkCleanupTarget(src, claimedDestination, options.copy ?? [])
  }
  await checkDestination()
  console.log(`Stopping active watch session ${session.id} before a one-shot build`)
  await requestWatchStop(session.id)
  return builder(src, claimedDestination, { static: true, ...options }, async claim => {
    if (claim.destination !== claimedDestination) {
      throw new WatchControlError('The claimed destination changed while replacing the watch session')
    }
    await checkDestination()
    const entries = await readdir(claim.destination).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    // Remove entries, not the destination directory itself or anything linked from it.
    for (const entry of entries) await rm(join(claim.destination, entry), { recursive: true, force: true })
  })
}
