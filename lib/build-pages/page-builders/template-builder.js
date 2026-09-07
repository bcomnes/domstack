/**
 * @import { TemplateInfo } from '../../identify-pages.js'
 * @import { DomstackManifestRecord } from '../../domstack-manifest/index.js'
 * @import { WatchDependencyTracker } from '../watch-dependencies.js'
 */

import { dirname, join, relative, resolve } from 'node:path'
import { writeFile, mkdir } from 'fs/promises'
import { createDomstackManifestRecord } from '../../domstack-manifest/index.js'
import { assertInsideDest, toPosix } from '../../helpers/path.js'
import { isAsyncIterable, isPlainObject } from '../../helpers/type-guards.js'
import { createSubscribedData, resolveDataDeps } from '../watch-dependencies.js'

/** @typedef {{
 *   outputName: string,
 *   content: string
 * }} TemplateOutputOverride */

/**
 * @param {unknown} value
 * @returns {value is TemplateOutputOverride}
 */
function isTemplateOutputOverride (value) {
  return isPlainObject(value) &&
    'outputName' in value &&
    typeof value['outputName'] === 'string' &&
    'content' in value &&
    typeof value['content'] === 'string'
}

/**
 * @param {unknown} value
 * @returns {value is TemplateOutputOverride[]}
 */
function isTemplateOutputOverrideArray (value) {
  return Array.isArray(value) && value.every(isTemplateOutputOverride)
}

/**
 * The parameters object passed to a {@link TemplateFunction} or {@link TemplateAsyncIterator}.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - The type of variables for the template
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @typedef {object} TemplateFunctionParams
 * @property {T} vars - Default and global variables.
 * @property {D} data - Global data declared by the template.
 * @property {TemplateInfo} template - Info about the current template.
 */

/**
 * Callback for rendering a template.
 *
 * @template {Record<string, any>} T - The type of variables for the template
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @callback TemplateFunction
 * @param {TemplateFunctionParams<T, D>} params - The parameters for the template.
 * @returns {Promise<string | TemplateOutputOverride | TemplateOutputOverride[]>}
 *  } - The results of a template build
 */

/**
 * Callback for rendering a template with an async iterator.
 * @template {Record<string, any>} T - The type of variables for the template async iterator
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @callback TemplateAsyncIterator
 * @param {TemplateFunctionParams<T, D>} params - Parameters of the template function.
 * @returns {AsyncIterable<TemplateOutputOverride>}
 */

/**
 * @typedef {object} TemplateReport
 * @property {TemplateInfo} templateInfo - The input TemplateInfo object.
 * @property {string[]} outputs - Output names written by the template.
 * @property {'content'|'object'|'array'|'async-iterator'} type - The template return type.
 */

/**
 * The template builder renders templates against global variables and declared data.
 * @template {Record<string, any>} T - The type of global variables for the template builder
 * @param {object}  params
 * @param  {string} params.dest       - The dest path of the site build.
 * @param  {T} params.globalVars - Default and global vars.
 * @param  {Record<string, unknown>} params.globalData - Values returned by global.data.
 * @param  {TemplateInfo} params.template   - The TemplateInfo of the template.
 * @param  {WatchDependencyTracker} params.watchDependencyTracker - Declarative watch dependency state.
 * @returns {Promise<{ report: TemplateReport, outputs: DomstackManifestRecord[] }>}
 */
export async function templateBuilder ({
  dest,
  globalVars,
  globalData,
  template,
  watchDependencyTracker,
}) {
  const importResults = await import(template.templateFile.filepath)
  if (!importResults.default || typeof importResults.default !== 'function') {
    throw new Error('Template file resolved to something other than a template function')
  }
  /** @type {TemplateFunction<T> | TemplateAsyncIterator<T>} The resolved template function */
  const renderTemplate = importResults.default
  const dataDeps = resolveDataDeps(
    importResults.dataDeps,
    `Template "${template.templateFile.relname}"`
  )
  watchDependencyTracker.registerConsumer(
    'template',
    template.templateFile.filepath,
    dataDeps
  )

  if (!renderTemplate) throw new Error(`Missing default export from template file: ${template.templateFile.relname}`)

  const finalVars = {
    vars: globalVars,
    data: createSubscribedData(
      globalData,
      dataDeps,
      `Template "${template.templateFile.relname}"`
    ),
    template,
  }

  const templateResults = await renderTemplate(finalVars)

  const fileDir = join(dest, template.path)

  /** @type {DomstackManifestRecord[]} */
  const outputRecords = []
  /** @type {TemplateReport['type']} */
  let type

  if (typeof templateResults === 'string') {
    type = 'content'
    await writeTemplateOutput({
      dest,
      fileDir,
      outputName: template.outputName,
      content: templateResults,
      template,
      outputRecords,
    })
  } else if (isTemplateOutputOverrideArray(templateResults)) {
    type = 'array'
    for (const templateResult of templateResults) {
      await writeTemplateOutput({
        dest,
        fileDir,
        outputName: templateResult.outputName,
        content: templateResult.content,
        template,
        outputRecords,
      })
    }
  } else if (isTemplateOutputOverride(templateResults)) {
    type = 'object'
    await writeTemplateOutput({
      dest,
      fileDir,
      outputName: templateResults.outputName,
      content: templateResults.content,
      template,
      outputRecords,
    })
  } else if (isAsyncIterable(templateResults)) {
    type = 'async-iterator'
    for await (const templateResult of templateResults) {
      if (isTemplateOutputOverride(templateResult)) {
        await writeTemplateOutput({
          dest,
          fileDir,
          outputName: templateResult.outputName,
          content: templateResult.content,
          template,
          outputRecords,
        })
      } else {
        throw new Error(`Template file returned unknown return type: ${typeof templateResult}`)
      }
    }
  } else {
    throw new Error(`Template file returned unknown return type: ${typeof templateResults}`)
  }

  return {
    report: {
      templateInfo: template,
      outputs: outputRecords.map(output => toPosix(relative(fileDir, output.filepath))),
      type,
    },
    outputs: outputRecords,
  }
}

/**
 * @param {object} params
 * @param {string} params.dest
 * @param {string} params.fileDir
 * @param {string} params.outputName
 * @param {string} params.content
 * @param {TemplateInfo} params.template
 * @param {DomstackManifestRecord[]} params.outputRecords
 */
async function writeTemplateOutput ({
  dest,
  fileDir,
  outputName,
  content,
  template,
  outputRecords,
}) {
  const filepath = resolve(fileDir, outputName)
  assertInsideDest(dest, filepath, `Template output escapes dest: ${filepath}`)
  const filePathDirname = dirname(filepath)
  await mkdir(filePathDirname, { recursive: true })
  await writeFile(filepath, content)

  const outputRelname = toPosix(relative(dest, filepath))
  outputRecords.push(createDomstackManifestRecord({
    dest,
    filepath,
    outputRelname,
    kind: 'template',
    sourceRelname: template.templateFile.relname,
    templatePath: template.path,
  }))
}
