/**
 * @import { TemplateFunction } from '#types'
 */

/**
 * @typedef SingleObjectTemplateVars
 * @property {string} foo
 */

/** @type {TemplateFunction<SingleObjectTemplateVars>} */
export default async ({
  vars: { foo },
}) => ({
  content: `Hello world

This is just a file with access to global vars: ${foo}`,
  outputName: './single-object-override.txt',
})
