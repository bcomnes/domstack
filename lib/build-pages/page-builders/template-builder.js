/**
 * @import { TemplateInfo } from '../../identify-pages.js'
 * @import { PageData } from '../page-data.js'
 */

import { join, resolve, dirname } from 'path'
import { writeFile, mkdir } from 'fs/promises'

/** @typedef {{
 *   outputName: string,
 *   content: string
 * }} TemplateOutputOverride */

/**
 * The parameters object passed to a {@link TemplateFunction} or {@link TemplateAsyncIterator}.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - The type of variables for the template
 * @typedef {object} TemplateFunctionParams
 * @property {T} vars - All of the site globalVars.
 * @property {TemplateInfo} template - Info about the current template.
 * @property {PageData<T, any, string>[]} pages - An array of info about every page.
 */

/**
 * Callback for rendering a template.
 *
 * @template {Record<string, any>} T - The type of variables for the template
 * @callback TemplateFunction
 * @param {object} params - The parameters for the template.
 * @param {T} params.vars - All of the site globalVars merged with global.data.js output.
 * @param {TemplateInfo} params.template - Info about the current template
 * @param {PageData<T, any, string>[]} params.pages - An array of info about every page
 * @returns {Promise<string | TemplateOutputOverride | TemplateOutputOverride[]>}
 *  } - The results of a template build
 */

/**
 * Callback for rendering a template with an async iterator.
 * @template T - The type of variables for the template async iterator
 * @callback TemplateAsyncIterator
 * @param {TemplateFunctionParams<T>} params - Parameters of the template function.
 * @returns {AsyncIterable<TemplateOutputOverride>}
 */

/**
 * @typedef TemplateReport
 *
 * @property {TemplateInfo} templateInfo - The input TemplateInfo object
 * @property {string[]} outputs - Array of paths the template output to
 * @property {'content'|'object'|'array'|'async-iterator'} [type] - The template return type
 */

/**
 * The template builder renders templates against the globalVars variables.
 * globalVars passed here already includes global.data.js output merged in.
 * @template {Record<string, any>} T - The type of global variables for the template builder
 * @param {object}  params
 * @param  {string} params.dest       - The dest path of the site build.
 * @param  {T} params.globalVars - globalVars merged with global.data.js output.
 * @param  {TemplateInfo} params.template   - The TemplateInfo of the template.
 * @param  {PageData<T, any, string>[]} params.pages      - The array of PageData object.
 */
export async function templateBuilder ({
  dest,
  globalVars,
  template,
  pages,
}) {
  const importResults = await import(template.templateFile.filepath)
  if (!importResults.default || typeof importResults.default !== 'function') {
    throw new Error('Template file resolved to something other than a template function')
  }
  /** @type {TemplateFunction<T> | TemplateAsyncIterator<T>} The resolved template function */
  const renderTemplate = importResults.default

  if (!renderTemplate) throw new Error(`Missing default export from template file: ${template.templateFile.relname}`)

  const finalVars = {
    vars: globalVars,
    pages,
    template,
  }

  const templateResults = await renderTemplate(finalVars)

  const fileDir = join(dest, template.path)
  const filePath = join(fileDir, template.outputName)

  /** @type {TemplateReport} */
  const templateReport = {
    templateInfo: template,
    outputs: [],
    type: 'content',
  }

  if (typeof templateResults === 'string') {
    await mkdir(fileDir, { recursive: true })
    await writeFile(filePath, templateResults)
    templateReport.outputs.push(template.outputName)
    templateReport.type = 'content'
  } else if (
    Array.isArray(templateResults) &&
    templateResults.every(item => 'outputName' in item && 'content' in item)
  ) {
    templateReport.type = 'array'
    for (const templateResult of templateResults) {
      const filePathOverride = resolve(fileDir, templateResult.outputName)
      const filePathOverrideDirname = dirname(filePathOverride)
      await mkdir(filePathOverrideDirname, { recursive: true })
      await writeFile(filePathOverride, templateResult.content)
      templateReport.outputs.push(templateResult.outputName)
    }
  } else if (
    typeof templateResults === 'object' &&
    'outputName' in templateResults &&
    'content' in templateResults
  ) {
    templateReport.type = 'object'
    const filePathOverride = resolve(fileDir, templateResults.outputName)
    const filePathOverrideDirname = dirname(filePathOverride)
    await mkdir(filePathOverrideDirname, { recursive: true })
    await writeFile(filePathOverride, templateResults.content)
    templateReport.outputs.push(templateResults.outputName)
  } else if (
    typeof templateResults === 'object' &&
    !Array.isArray(templateResults) &&
    typeof templateResults[Symbol.asyncIterator] === 'function') {
    templateReport.type = 'async-iterator'
    for await (const templateResult of templateResults) {
      if ('outputName' in templateResult && 'content' in templateResult) {
        const filePathOverride = resolve(fileDir, templateResult.outputName)
        const filePathOverrideDirname = dirname(filePathOverride)
        await mkdir(filePathOverrideDirname, { recursive: true })
        await writeFile(filePathOverride, templateResult.content)
        templateReport.outputs.push(templateResult.outputName)
      } else {
        throw new Error(`Template file returned unknown return type: ${typeof templateResult}`)
      }
    }
  } else {
    throw new Error(`Template file returned unknown return type: ${typeof templateResults}`)
  }

  return templateReport
}
