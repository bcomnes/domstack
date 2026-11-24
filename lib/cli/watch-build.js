/**
 * @import { CliValues } from './args.js'
 * @import { DomStackOpts } from '../builder.js'
 */

import { createSessionRegistry } from '@domstack/sync'
import { builder } from '../builder.js'
import { resolveCanonicalPath } from '../helpers/path.js'
import { checkCleanupTarget } from '../helpers/clean-dest.js'
import { requestWatchRebuild, requestWatchStop, WatchControlError } from '../watch/control.js'

// Source and destination select the owner; these options would change its output.
const outputFlags = ['copy', 'drafts', 'ignore', 'noEsbuildMeta', 'domstackManifest', 'no-clean']

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
  console.log(`Checking pending builds in active watch session ${session.id}`)
  await requestWatchRebuild(session.id)
  console.log('Watch build queue checked successfully')
  return true
}

/** @param {string} src @param {string} dest @param {string} claimedDestination @param {DomStackOpts} options */
export async function replaceWatchBuild (src, dest, claimedDestination, options) {
  const session = await findMatchingWatch(src, claimedDestination)
  if (!session) return null
  const checkDestination = async () => {
    if (await resolveCanonicalPath(dest) !== claimedDestination) {
      throw new WatchControlError('The requested destination changed while replacing the watch session')
    }
    try {
      if (options.clean !== false) await checkCleanupTarget(src, claimedDestination, options.copy ?? [])
    } catch (error) {
      if (!(error instanceof Error)) throw error
      throw new WatchControlError(error.message, { cause: error })
    }
  }
  await checkDestination()
  console.log(`Stopping active watch session ${session.id} before a one-shot build`)
  await requestWatchStop(session.id)
  return builder(src, claimedDestination, { static: true, ...options }, async claim => {
    if (claim.destination !== claimedDestination) {
      throw new WatchControlError('The claimed destination changed while replacing the watch session')
    }
    await checkDestination()
  })
}
