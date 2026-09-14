/**
 * @import { PageInfo } from '../identify-pages.js'
 *
 * @typedef {object} AdditionalOutput
 * @property {string} outputName
 * @property {string} content
 *
 * @typedef {object} AdditionalOutputProvenance
 * @property {'page' | 'companion' | 'layout'} kind
 * @property {string} source - Provider module path (layout name when no path is available).
 * @property {string} [layoutName]
 *
 * @typedef {AdditionalOutput & { provenance: AdditionalOutputProvenance }} CollectedAdditionalOutput
 * @typedef {AdditionalOutput | AdditionalOutput[] | AsyncIterable<AdditionalOutput>} AdditionalOutputsResult
 * @typedef {Readonly<Pick<PageInfo, 'type' | 'path' | 'url' | 'outputName' | 'outputRelname' | 'draft'>> & { readonly pageFile: Readonly<PageInfo['pageFile']>, readonly readMarkdownContent: () => Promise<string> }} AdditionalOutputsPage
 */

/**
 * @template {Record<string, any>} [T=Record<string, unknown>]
 * @template {object} [D=Record<string, unknown>]
 * @typedef {object} AdditionalOutputsFunctionParams
 * @property {AdditionalOutputsPage} page - Read-only source metadata, without rendering or global-data access.
 * @property {Readonly<T>} vars
 * @property {D} data - The same subscriptions as this provider's renderer.
 */

/**
 * @template {Record<string, any>} [T=Record<string, unknown>]
 * @template {object} [D=Record<string, unknown>]
 * @callback AdditionalOutputsFunction
 * @param {AdditionalOutputsFunctionParams<T, D>} params
 * @returns {AdditionalOutputsResult | Promise<AdditionalOutputsResult>}
 */

/**
 * @param {unknown} hook
 * @param {string} source
 * @returns {AdditionalOutputsFunction<any, any> | undefined}
 */
export function validateAdditionalOutputsHook (hook, source) {
  if (hook === undefined) return undefined
  if (typeof hook !== 'function') throw new TypeError(`additionalOutputs in "${source}" must be a function`)
  return /** @type {AdditionalOutputsFunction<any, any>} */ (hook)
}

/**
 * Normalize one provider's result, preserving order and diagnostic context.
 * Output destination containment and collisions are enforced by the output writer.
 * @param {unknown} result
 * @param {AdditionalOutputProvenance} provenance
 * @returns {Promise<CollectedAdditionalOutput[]>}
 */
export async function normalizeAdditionalOutputs (result, provenance) {
  /** @type {CollectedAdditionalOutput[]} */
  const outputs = []
  /** @param {unknown} record */
  const append = (record) => {
    if (!record || typeof record !== 'object' ||
      !('outputName' in record) || typeof record.outputName !== 'string' || !record.outputName.trim() ||
      !('content' in record) || typeof record.content !== 'string') {
      throw new TypeError(`Record ${outputs.length + 1} must be { outputName: non-empty string, content: string }`)
    }
    outputs.push({ outputName: record.outputName, content: record.content, provenance: { ...provenance } })
  }
  try {
    const resolved = await result
    if (Array.isArray(resolved)) {
      for (const record of resolved) append(record)
    } else if (resolved && typeof resolved === 'object' && Symbol.asyncIterator in resolved) {
      for await (const record of /** @type {AsyncIterable<unknown>} */ (resolved)) append(record)
    } else {
      append(resolved)
    }
    return outputs
  } catch (cause) {
    throw new Error(`Invalid additionalOutputs from ${provenance.kind} "${provenance.source}": ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}

/**
 * @param {PageInfo} info
 * @param {() => Promise<string>} readMarkdownContent - Bound to the source, never to caller-supplied metadata.
 * @returns {AdditionalOutputsPage}
 */
export function createAdditionalOutputsPage (info, readMarkdownContent) {
  const { type, path, url, outputName, outputRelname, draft, pageFile } = info
  return Object.freeze({
    type,
    path,
    url,
    outputName,
    outputRelname,
    draft,
    pageFile: Object.freeze({ ...pageFile }),
    readMarkdownContent,
  })
}
