/**
 * @import markdownIt from 'markdown-it'
 */
import { getMd } from './get-md.js'

/**
 * Share pending and resolved renderers only for the lifetime of one build.
 * @param {typeof getMd} [loadMd]
 * @returns {typeof getMd}
 */
export function createMdResolver (loadMd = getMd) {
  /** @type {Map<string | null, Promise<InstanceType<typeof markdownIt>>>} */
  const renderers = new Map()

  return (settingsPath) => {
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
}
