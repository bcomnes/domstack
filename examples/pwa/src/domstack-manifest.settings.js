/**
 * @import { DomstackManifestEntry } from '@domstack/static'
 */

import { pwaManifestExclude, shouldIncludePwaOutput } from './pwa/cache-policy.js'

const origin = 'https://example.com'

export default {
  exclude: pwaManifestExclude,
  includeEntry,
}

/**
 * Keep PWA cache policy close to the application while still letting Domstack
 * emit a normal domstack manifest for the service worker to consume.
 *
 * @param {DomstackManifestEntry} entry
 */
function includeEntry (entry) {
  return shouldIncludePwaOutput(entry, origin)
}
