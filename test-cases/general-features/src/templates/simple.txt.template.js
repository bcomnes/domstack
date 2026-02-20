/**
 * @import { TemplateFunction } from '../../../../index.js'
 */
/**
 * @type {TemplateFunction<{
 * foo: string,
 * testVar: string
 * }>}
 */
export default async ({
  vars: {
    foo,
  },
}) => {
  return `Hello world

This is just a file with access to global vars: ${foo}
`
}
