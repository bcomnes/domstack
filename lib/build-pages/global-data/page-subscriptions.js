/**
 * @import { PageInfo } from '../../identify-pages.js'
 */
import { createSubscribedData } from './data-deps.js'
import { DomStackDataError } from '../../helpers/domstack-error.js'

/**
 * Per-page access to published data, separate from producer state and watch fingerprints.
 * @template {object} [D=Record<string, unknown>]
 */
export class PageSubscriptions {
  /** @type {string[]} */ #pageKeys = []
  /** @type {Map<string, { keys: string[], data: Record<string, unknown> }>} */ #layouts = new Map()
  /** @type {D} */ #data = /** @type {D} */ (Object.freeze({}))
  #ready = false

  /** @param {string[]} companionKeys @param {string[]} builderKeys */
  setPageDependencies (companionKeys, builderKeys) {
    this.#pageKeys = [...new Set([...companionKeys, ...builderKeys])].sort()
  }

  /** @param {string} name @param {string[]} keys */
  addLayout (name, keys) {
    this.#layouts.set(name, { keys, data: Object.freeze({}) })
  }

  /** The invalidation union is broader than any individual renderer's access. */
  get dependencies () {
    const keys = new Set(this.#pageKeys)
    for (const layout of this.#layouts.values()) {
      for (const key of layout.keys) keys.add(key)
    }
    return [...keys].sort()
  }

  /** @param {string[]} dependencies @param {PageInfo} pageInfo */
  assertReady (dependencies, pageInfo) {
    if (!this.#ready && dependencies.length > 0) {
      throw new DomStackDataError(
        `Global data is not available while resolving global.data for page "${pageInfo.pageFile.relname}" or its layouts`,
        { reason: 'NOT_READY', consumer: `Page "${pageInfo.pageFile.relname}"` }
      )
    }
  }

  /** @param {PageInfo} pageInfo @returns {D} */
  getPageData (pageInfo) {
    this.assertReady(this.#pageKeys, pageInfo)
    return this.#data
  }

  /** @param {string} name @param {PageInfo} pageInfo */
  getLayoutData (name, pageInfo) {
    const subscription = this.#layouts.get(name)
    if (subscription) this.assertReady(subscription.keys, pageInfo)
    return subscription?.data
  }

  /** @param {Record<string, unknown>} globalData @param {PageInfo} pageInfo */
  bind (globalData, pageInfo) {
    this.#data = /** @type {D} */ (createSubscribedData(globalData, this.#pageKeys, `Page "${pageInfo.pageFile.relname}"`))
    for (const [name, subscription] of this.#layouts) {
      subscription.data = createSubscribedData(globalData, subscription.keys, `Layout "${name}"`)
    }
    this.#ready = true
  }
}
