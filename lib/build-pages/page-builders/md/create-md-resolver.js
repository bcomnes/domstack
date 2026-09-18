/**
 * @import markdownIt from 'markdown-it'
 * @import { getMd } from './get-md.js'
 */

/** @type {WeakSet<typeof getMd>} Resolvers whose initialization runs only built-in code without settings. */
const defaultResolvers = new WeakSet()

/** @type {typeof getMd} */
async function loadDefaultMd (settingsPath) {
  const { getMd } = await import('./get-md.js')
  return getMd(settingsPath)
}

/** @param {typeof getMd} resolver */
export function isDefaultMdResolver (resolver) {
  return defaultResolvers.has(resolver)
}

/**
 * Share pending and resolved renderers only for the lifetime of one build.
 * @param {typeof getMd} [loadMd]
 * @returns {typeof getMd}
 */
export function createMdResolver (loadMd = loadDefaultMd) {
  /** @type {Map<string | null, Promise<InstanceType<typeof markdownIt>>>} */
  const renderers = new Map()

  /** @type {typeof getMd} */
  const resolve = (settingsPath) => {
    const key = settingsPath || null
    let pending = renderers.get(key)
    if (!pending) {
      pending = loadMd(key).catch(error => {
        renderers.delete(key)
        throw error
      })
      renderers.set(key, pending)
    }
    return pending
  }
  if (loadMd === loadDefaultMd) defaultResolvers.add(resolve)
  return resolve
}
