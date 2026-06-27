/**
 * @import { TemplateInfo } from '../../identify-pages.js'
 * @import { PageData } from '../page-data.js'
 * @import { DomstackManifestRecord } from '../../domstack-manifest/index.js'
 */

import { join, resolve, dirname } from 'path'
import { relative, sep, isAbsolute } from 'node:path'
import { writeFile, mkdir } from 'fs/promises'
import { createDomstackManifestRecord } from '../../domstack-manifest/index.js'

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
 * @param {TemplateFunctionParams<T>} params - The parameters for the template.
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
 * The template builder renders templates against the globalVars variables.
 * globalVars passed here already includes global.data.js output merged in.
 * @template {Record<string, any>} T - The type of global variables for the template builder
 * @param {object}  params
 * @param  {string} params.dest       - The dest path of the site build.
 * @param  {T} params.globalVars - globalVars merged with global.data.js output.
 * @param  {TemplateInfo} params.template   - The TemplateInfo of the template.
 * @param  {PageData<T, any, string>[]} params.pages      - The array of PageData object.
 * @returns {Promise<DomstackManifestRecord[]>}
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

  /** @type {DomstackManifestRecord[]} */
  const outputRecords = []

  if (typeof templateResults === 'string') {
    await writeTemplateOutput({
      dest,
      fileDir,
      outputName: template.outputName,
      content: templateResults,
      template,
      outputRecords,
    })
  } else if (
    Array.isArray(templateResults) &&
    templateResults.every(item => 'outputName' in item && 'content' in item)
  ) {
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
  } else if (
    templateResults &&
    typeof templateResults === 'object' &&
    'outputName' in templateResults &&
    'content' in templateResults
  ) {
    await writeTemplateOutput({
      dest,
      fileDir,
      outputName: templateResults.outputName,
      content: templateResults.content,
      template,
      outputRecords,
    })
  } else if (
    templateResults &&
    typeof templateResults === 'object' &&
    !Array.isArray(templateResults) &&
    typeof templateResults[Symbol.asyncIterator] === 'function') {
    for await (const templateResult of templateResults) {
      if ('outputName' in templateResult && 'content' in templateResult) {
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

  return outputRecords
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
  assertInsideDest(dest, filepath)
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

/**
 * @param {string} dest
 * @param {string} filepath
 */
function assertInsideDest (dest, filepath) {
  const absDest = resolve(dest)
  const absFilepath = resolve(filepath)
  const rel = relative(absDest, absFilepath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Template output escapes dest: ${filepath}`)
  }
}

/**
 * @param {string} value
 */
function toPosix (value) {
  return value.split(sep).join('/')
}
