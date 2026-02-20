/**
 * @import { TemplateAsyncIterator } from '../../../../index.js'
 */
/**
 * @type {TemplateAsyncIterator<{
 * foo: string,
 * testVar: string
 * }>}
 */
export default async function * ({
  vars: {
    foo,
    testVar,
  },
}) {
  // First item
  yield {
    content: `Hello world

This is just a file with access to global vars: ${foo}`,
    outputName: 'async-iterator-1.txt',
  }

  // Second item
  yield {
    content: `Hello world again

This is just a file with access to global vars: ${testVar}`,
    outputName: 'async-iterator-2.txt',
  }
}
