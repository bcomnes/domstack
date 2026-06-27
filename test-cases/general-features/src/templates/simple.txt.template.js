/**
 * @import { TemplateFunction } from '#types'
 */

/**
 * @typedef SimpleTemplateVars
 * @property {string} foo
 * @property {string} testVar
 */

/** @type {TemplateFunction<SimpleTemplateVars>} */
export default async ({
  vars: {
    foo,
  },
}) => {
  return `Hello world

This is just a file with access to global vars: ${foo}
`
}
