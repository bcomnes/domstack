/**
 * @import { DomstackManifestEntry } from '@domstack/static'
 */

import { manifestExclude, shouldIncludeManifestEntry } from './cache-policy.js'

const origin = 'https://example.com'

export default {
  exclude: manifestExclude,
  includeEntry,
}

/**
 * Keep Workbox precache policy close to the application while still letting
 * Domstack emit a normal domstack manifest for the service worker to consume.
 *
 * @param {DomstackManifestEntry} entry
 */
function includeEntry (entry) {
  return shouldIncludeManifestEntry(entry, origin)
}
