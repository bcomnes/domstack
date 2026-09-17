/**
 * @import { LayoutFunction, PageOutputsFunctionParams } from '#types'
 */

/** @type {LayoutFunction<object, string, string>} */
export default ({ children }) => `<main>${children}</main>`

/** @param {PageOutputsFunctionParams} params */
export const pageOutputs = async ({ page }) => ({
  outputName: 'source.md',
  content: await page.readMarkdownContent(),
})
