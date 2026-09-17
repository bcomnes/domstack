/**
 * @import { PageData } from '../page/page-data.js'
 * @import { PageSubscriptions } from '../global-data/page-subscriptions.js'
 * @import { PageOutputsFunction, PageOutputProvenance, CollectedPageOutput } from './page-outputs.js'
 */
import { readFile } from 'node:fs/promises'
import { parseMdFileContents } from '../page-builders/md/parse-md.js'
import { DomStackDataError } from '../../helpers/domstack-error.js'
import { createPageOutputsPage, normalizePageOutputs, validatePageOutputsHook } from './page-outputs.js'

/**
 * @template {Record<string, any>} T
 * @typedef {object} PageOutputProvider
 * @property {PageOutputsFunction<T, any>} hook
 * @property {PageOutputProvenance} provenance
 */

/**
 * Collect outputs from an initialized source page without writing files or retaining records.
 * Layout hooks run outermost first, followed by the selected page-level provider.
 * @template {Record<string, any>} T
 * @param {Pick<PageData<T, any, any, any>, 'pageInfo' | 'vars' | 'data' | 'layoutChain'>} pageData
 * @param {PageSubscriptions<any>} subscriptions
 * @param {PageOutputProvider<T> | undefined} pageOutputs
 * @returns {AsyncGenerator<CollectedPageOutput, void, unknown>}
 */
export async function * collectPageOutputs (pageData, subscriptions, pageOutputs) {
  // Capture source metadata so rebinding the reader cannot change its source.
  const sourceInfo = { ...pageData.pageInfo, pageFile: { ...pageData.pageInfo.pageFile } }
  const page = createPageOutputsPage(sourceInfo, async () => {
    if (sourceInfo.type !== 'md') throw new Error('Markdown content can only be read from markdown pages')
    return parseMdFileContents(await readFile(sourceInfo.pageFile.filepath, 'utf8')).markdownContent
  })
  /**
   * @param {PageOutputsFunction<T, any>} hook
   * @param {PageOutputProvenance} provenance
   * @param {() => object} getData
   * @returns {AsyncGenerator<CollectedPageOutput, void, unknown>}
   */
  const collect = async function * (hook, provenance, getData) {
    try {
      yield * normalizePageOutputs(hook({ page, vars: pageData.vars, data: getData() }), provenance)
    } catch (cause) {
      const message = `pageOutputs for page "${pageData.pageInfo.pageFile.relname}" from ${provenance.kind} "${provenance.source}" failed: ${cause instanceof Error ? cause.message : String(cause)}`
      throw cause instanceof DomStackDataError
        ? new DomStackDataError(message, cause.dataDependency, { cause })
        : new Error(message, { cause })
    }
  }
  for (const layout of pageData.layoutChain) {
    const source = layout.source ?? layout.name
    const hook = validatePageOutputsHook(layout.pageOutputs, source)
    if (!hook) continue
    yield * collect(hook, { kind: 'layout', source, layoutName: layout.name }, () => {
      return subscriptions.getLayoutData(layout.name, pageData.pageInfo) ?? Object.freeze({})
    })
  }
  if (pageOutputs) {
    const { hook, provenance } = pageOutputs
    yield * collect(hook, provenance, () => pageData.data)
  }
}
