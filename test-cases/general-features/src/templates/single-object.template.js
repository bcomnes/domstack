/**
 * @import { TemplateFunction } from '../../../../index.js'
 */
/**
 * @type {TemplateFunction<{
 * foo: string,
 * }>}
 */
export default async ({
  vars: { foo },
}) => ({
  content: `Hello world

This is just a file with access to global vars: ${foo}`,
  outputName: './single-object-override.txt',
})
