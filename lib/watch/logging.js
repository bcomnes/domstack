/**
 * @import { Results } from '../builder.js'
 * @import { WorkerBuildStepResult } from '../build-pages/index.js'
 * @import { PageInfo, TemplateInfo } from '../identify-pages.js'
 * @import { Logger as PinoLogger } from 'pino'
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 */
import { relative } from 'node:path'
import { inspect } from 'node:util'

/**
 * Log a rebuild tree showing what triggered a rebuild and what will be rebuilt.
 * @param {string} trigger - The changed file (display name)
 * @param {PinoLogger} logger
 * @param {Set<PageInfo>} [pages]
 * @param {Set<TemplateInfo>} [templates]
 */
export function logRebuildTree (trigger, logger, pages, templates) {
  if (logger.isLevelEnabled?.('info') === false) return
  const lines = [`"${trigger}" changed:`]
  for (const p of pages ?? []) {
    lines.push(`  → ${p.outputRelname}`)
  }
  for (const t of templates ?? []) {
    lines.push(`  → ${t.outputName} (template)`)
  }
  logger.info(lines.join('\n'))
}

/**
 * An error logger
 * @param {Error | AggregateError | any} err The error to log
 * @param {PinoLogger} logger
 */
export function errorLogger (err, logger) {
  if (!(err instanceof Error || err instanceof AggregateError)) throw new Error('Non-error thrown', { cause: err })
  if ('results' in err) delete err.results
  logger.error(inspect(err, { depth: 999, colors: true }))
  logger.error('Build Failed!')
}

/**
 * Log build results.
 * @param {Partial<Results> | WorkerBuildStepResult} results
 * @param {PinoLogger} logger
 * @param {string} [dest] - dest path for relativizing output paths in filtered builds
 */
export function buildLogger (results, logger, dest) {
  if ((results?.warnings?.length ?? 0) > 0) {
    logger.warn('There were build warnings:')
  }
  for (const warning of results?.warnings ?? []) {
    if ('message' in warning) {
      logger.warn(`  ${warning.message}`)
    } else {
      logger.warn(inspect(warning, { depth: 999, colors: true }))
    }
  }

  if (logger.isLevelEnabled?.('info') === false) return

  if ('siteData' in results && results.siteData) {
    // Full build: show site totals
    const layoutCount = Object.keys(results.siteData.layouts).length
    logger.info(`Source pages: ${results.siteData.pages.length} Layouts: ${layoutCount} Templates: ${results.siteData.templates.length}`)
    const outputs = results.pageBuildResults?.outputs
    if (outputs) {
      const summary = summarizePageDomstackManifests(outputs)
      logger.info(`Pages built: ${summary.pages} Templates built: ${summary.templates}`)
    }
  } else if ('outputs' in results) {
    // Filtered build: show what was actually built
    const outputs = results.outputs
    if (dest) {
      for (const output of outputs) {
        if (output.kind === 'page' || output.kind === 'template') {
          logger.info(`  Built ${relative(dest, output.filepath)}`)
        }
      }
    }
    const summary = summarizePageDomstackManifests(outputs)
    logger.info(`Pages built: ${summary.pages} Templates built: ${summary.templates}`)
  }
  logger.info('Build Success!')
}

/** @param {DomstackManifestRecord[]} outputs */
function summarizePageDomstackManifests (outputs) {
  const templateSources = new Set()
  let pages = 0

  for (const output of outputs) {
    if (output.kind === 'page') pages += 1
    if (output.kind === 'template') {
      templateSources.add(output.sourceRelname ?? output.templatePath ?? output.outputRelname)
    }
  }

  return {
    pages,
    templates: templateSources.size,
  }
}
