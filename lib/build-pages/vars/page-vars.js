/**
 * @template {Record<string, any>} T
 * @typedef {object} PageVarSources
 * @property {Partial<T>} globalVars
 * @property {{ vars: Partial<T> }[]} layoutVars
 * @property {Partial<T> | null} pageVars
 * @property {Partial<T> | null} builderVars
 */

/**
 * Cache the variable cascade without owning or copying the page's mutable sources.
 * @template {Record<string, any>} T
 */
export class PageVars {
  /** @type {T | null} */ #cache = null
  /** @type {(Partial<T> | null)[] | null} */ #sources = null

  /** @param {PageVarSources<T>} page @returns {T} */
  get (page) {
    if (this.#cache && this.#sourcesUnchanged(page)) return this.#cache
    const sources = this.#collectSources(page)
    // Commit both cache fields only after a successful merge.
    this.#cache = /** @type {T} */ (Object.freeze(this.#merge(sources)))
    this.#sources = sources
    return this.#cache
  }

  /**
   * Initialization needs default-asset vars without establishing the cached snapshot.
   * @param {PageVarSources<T>} page
   * @returns {T}
   */
  merge (page) {
    return this.#merge(this.#collectSources(page))
  }

  /** @param {PageVarSources<T>} page */
  #collectSources (page) {
    return [page.globalVars, ...page.layoutVars.map(layout => layout.vars), page.pageVars, page.builderVars]
  }

  /** @param {PageVarSources<T>} page */
  #sourcesUnchanged (page) {
    const sources = this.#sources
    const layoutCount = page.layoutVars.length
    if (
      !sources ||
      sources.length !== layoutCount + 3 ||
      sources[0] !== page.globalVars ||
      sources[layoutCount + 1] !== page.pageVars ||
      sources[layoutCount + 2] !== page.builderVars
    ) return false

    for (let index = 0; index < layoutCount; index++) {
      const layout = page.layoutVars[index]
      if (!layout || sources[index + 1] !== layout.vars) return false
    }
    return true
  }

  /** @param {(Partial<T> | null)[]} sources */
  #merge (sources) {
    // Match spread semantics for __proto__ and inherited setters without copying
    // the growing result for each source.
    const merged = Object.create(null)
    for (const vars of sources) Object.assign(merged, vars)
    Object.setPrototypeOf(merged, Object.prototype)
    return /** @type {T} */ (merged)
  }
}
