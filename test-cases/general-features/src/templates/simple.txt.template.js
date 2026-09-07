/**
 * @import { AsyncTemplateFunction } from '#types'
 */

/**
 * @typedef SimpleTemplateVars
 * @property {string} foo
 * @property {string} testVar
 */

/** @type {AsyncTemplateFunction<SimpleTemplateVars>} */
export default async ({
  vars: {
    foo,
  },
}) => {
  return `Hello world

This is just a file with access to global vars: ${foo}
`
}
