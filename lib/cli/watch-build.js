/** @import { CliValues } from './args.js' */

import { createSessionRegistry } from '@domstack/sync'
import { canonicalBuildPath } from '../destination-claim.js'
import { requestWatchRebuild, WatchControlError } from '../watch/control.js'

// Source and destination select the owner; these options would change its output.
const outputFlags = ['copy', 'drafts', 'ignore', 'noEsbuildMeta', 'domstackManifest']

/** @param {string} src @param {string} destination */
export async function findMatchingWatch (src, destination) {
  const source = await canonicalBuildPath(src)
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
    throw new WatchControlError(`Cannot delegate with ${supplied.map(flag => `--${flag}`).join(', ')}; stop the active watcher to use different build options`)
  }
  console.log(`Rebuilding via active watch session ${session.id} (watch mode)`)
  await requestWatchRebuild(session.id)
  console.log('Watch rebuild succeeded')
  return true
}
