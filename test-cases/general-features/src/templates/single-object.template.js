/**
 * @import { AsyncTemplateFunction } from '#types'
 */

/**
 * @typedef SingleObjectTemplateVars
 * @property {string} foo
 */

/** @type {AsyncTemplateFunction<SingleObjectTemplateVars>} */
export default async ({
  vars: { foo },
}) => ({
  content: `Hello world

This is just a file with access to global vars: ${foo}`,
  outputName: './single-object-override.txt',
})
