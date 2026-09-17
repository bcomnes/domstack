/**
 * @import { SiteData } from '../../builder.js'
 * @import { PageInfo, PagesFileInfo } from '../../identify-pages.js'
 * @import { GeneratedPageDefinition } from '../index.js'
 * @import { WatchDependencyTracker } from '../data/watch-dependencies.js'
 */

import { basename, dirname, isAbsolute, join, normalize, resolve } from 'path'
import { computePageUrl } from '../compute-page-url.js'
import { DomStackOutputConflictError } from '../../helpers/domstack-error.js'
import { isAsyncIterable, isPlainObject } from '../../helpers/type-guards.js'
import { createSubscribedData, resolveDataDeps } from '../data/data-deps.js'

/**
 * @param {unknown} value
 * @returns {GeneratedPageDefinition}
 */
function validateGeneratedPageDefinition (value) {
  if (!isPlainObject(value)) {
    throw new TypeError('Generated page definition must be an object')
  }

  if ('outputName' in value && value['outputName'] !== undefined && typeof value['outputName'] !== 'string') {
    throw new TypeError('Generated page outputName must be a string')
  }
  if ('vars' in value && value['vars'] !== undefined && !isPlainObject(value['vars'])) {
    throw new TypeError('Generated page vars must be an object')
  }
  if ('draft' in value && value['draft'] !== undefined && typeof value['draft'] !== 'boolean') {
    throw new TypeError('Generated page draft must be a boolean')
  }

  return /** @type {GeneratedPageDefinition} */ (value)
}

/**
 * @param {unknown} value
 * @returns {AsyncGenerator<GeneratedPageDefinition>}
 */
async function * iterateGeneratedPageDefinitions (value) {
  if (value == null) return

  if (Array.isArray(value) || isAsyncIterable(value)) {
    for await (const definition of value) yield validateGeneratedPageDefinition(definition)
  } else {
    yield validateGeneratedPageDefinition(value)
  }
}

/**
 * @param {string} value
 * @param {object} opts
 * @param {string} opts.field
 * @param {boolean} [opts.allowEmpty]
 * @returns {string}
 */
function normalizeGeneratedOutputPart (value, { field, allowEmpty = false }) {
  if (typeof value !== 'string') throw new TypeError(`Generated page ${field} must be a string`)
  if (!allowEmpty && value.length === 0) throw new Error(`Generated page ${field} must not be empty`)
  if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) throw new Error(`Generated page ${field} must be relative: ${value}`)
  if (value.split(/[\\/]+/).includes('..')) throw new Error(`Generated page ${field} must not contain ".." segments: ${value}`)
  if (/[\\/]$/.test(value)) throw new Error(`Generated page ${field} must name a file: ${value}`)

  const normalized = normalize(value)
  if (!allowEmpty && normalized === '.') throw new Error(`Generated page ${field} must not be empty`)
  return normalized === '.' ? '' : normalized
}

/**
 * @param {object} params
 * @param {GeneratedPageDefinition} params.definition
 * @param {PagesFileInfo} params.pagesFile
 * @param {number} params.index
 * @returns {PageInfo}
 */
function generatedDefinitionToPageInfo ({ definition, pagesFile, index }) {
  const relativeOutputName = normalizeGeneratedOutputPart(definition.outputName ?? `${pagesFile.name}/index.html`, { field: 'outputName' })
  const outputRelname = join(pagesFile.path, relativeOutputName)
  const generatedPath = dirname(outputRelname) === '.' ? '' : dirname(outputRelname)
  const outputName = basename(outputRelname)

  return {
    pageFile: {
      ...pagesFile.pagesFile,
      basename: `${pagesFile.pagesFile.basename}#${index}`,
      relname: `${pagesFile.pagesFile.relname}#${index}`,
      type: 'js',
    },
    type: 'js',
    path: generatedPath,
    url: computePageUrl({ path: generatedPath, outputName }),
    outputName,
    outputRelname,
    draft: Boolean(definition.draft),
    generated: {
      pagesFile,
      vars: definition.vars ?? {},
      children: definition.children,
    },
  }
}

/**
 * @param {object} params
 * @param {SiteData} params.siteData
 * @param {Record<string, any>} params.factoryVars
 * @param {Record<string, unknown>} params.globalData
 * @param {Set<string> | null} params.pagesFileFilterSet
 * @param {boolean | undefined} params.buildDrafts
 * @param {WatchDependencyTracker} params.watchDependencyTracker
 * @returns {AsyncGenerator<PageInfo>}
 */
export async function * resolveGeneratedPageInfos ({ siteData, factoryVars, globalData, pagesFileFilterSet, buildDrafts, watchDependencyTracker }) {
  const pagesFiles = siteData.pagesFiles ?? []
  // No generated writes means no collision reservations are needed.
  if (pagesFileFilterSet?.size === 0 || !pagesFiles.some(owner => !pagesFileFilterSet || pagesFileFilterSet.has(owner.pagesFile.filepath))) return

  /** @type {Map<string, { type: 'page', path: string }>} */
  const pageOutputClaims = new Map()

  for (const pageInfo of siteData.pages) {
    pageOutputClaims.set(resolve(pageInfo.outputRelname), {
      type: 'page',
      path: pageInfo.pageFile.relname,
    })
  }

  // Unselected factories keep their outputs. Reserve those paths without
  // rerunning the owners, so a targeted build cannot silently overwrite them.
  if (pagesFileFilterSet) {
    const ownerRelnames = new Map(pagesFiles.map(({ pagesFile }) => [pagesFile.filepath, pagesFile.relname]))
    for (const consumer of Object.values(watchDependencyTracker.state.consumers)) {
      if (consumer.type === 'page' && consumer.ownerPath && !pagesFileFilterSet.has(consumer.ownerPath)) {
        pageOutputClaims.set(resolve(consumer.key), { type: 'page', path: ownerRelnames.get(consumer.ownerPath) ?? consumer.key })
      }
    }
  }

  for (const pagesFile of pagesFiles) {
    if (pagesFileFilterSet && !pagesFileFilterSet.has(pagesFile.pagesFile.filepath)) continue

    try {
      const importResults = await import(pagesFile.pagesFile.filepath)
      if (!('default' in importResults)) throw new Error(`Missing default export from pages file: ${pagesFile.pagesFile.relname}`)

      const pagesExport = importResults.default
      const dataDeps = resolveDataDeps(
        importResults.dataDeps,
        `Pages file "${pagesFile.pagesFile.relname}"`
      )
      watchDependencyTracker.registerConsumer(
        'pages-file',
        pagesFile.pagesFile.filepath,
        dataDeps
      )
      const pagesResults = typeof pagesExport === 'function'
        ? await pagesExport({
          vars: factoryVars,
          data: createSubscribedData(
            globalData,
            dataDeps,
            `Pages file "${pagesFile.pagesFile.relname}"`
          ),
          pagesFile,
        })
        : pagesExport

      let index = 0
      for await (const definition of iterateGeneratedPageDefinitions(pagesResults)) {
        const generatedPageInfo = generatedDefinitionToPageInfo({ definition, pagesFile, index: index++ })
        if (generatedPageInfo.draft && !buildDrafts) continue

        const outputKey = resolve(generatedPageInfo.outputRelname)
        const existingClaim = pageOutputClaims.get(outputKey)
        const generatedClaim = {
          type: /** @type {const} */ ('page'),
          path: generatedPageInfo.pageFile.relname,
        }
        if (existingClaim) {
          throw new DomStackOutputConflictError(
            `Output path conflict: ${generatedPageInfo.outputRelname} is produced by both ${existingClaim.path} and ${generatedClaim.path}.`,
            {
              outputPath: generatedPageInfo.outputRelname,
              a: existingClaim,
              b: generatedClaim,
            }
          )
        }

        pageOutputClaims.set(outputKey, generatedClaim)
        yield generatedPageInfo
      }
    } catch (err) {
      const error = err instanceof Error
        ? err
        : new Error('Non-error thrown while resolving generated pages', { cause: err })
      Object.assign(error, { pagesFile })
      throw error
    }
  }
}
