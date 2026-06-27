/**
 * @import { TemplateFunction } from '#types'
 */

/**
 * @typedef ObjectArrayTemplateVars
 * @property {string} foo
 * @property {string} testVar
 */

/** @type {TemplateFunction<ObjectArrayTemplateVars>} */
export default async function objectArrayTemplate ({
  vars: {
    foo,
    testVar,
  },
}) {
  return [
    {
      content: `Hello world

This is just a file with access to global vars: ${foo}`,
      outputName: 'object-array-1.txt',
    },
    {
      content: `Hello world again

This is just a file with access to global vars: ${testVar}`,
      outputName: 'object-array-2.txt',
    },
  ]
}
