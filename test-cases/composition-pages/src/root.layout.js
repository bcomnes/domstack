/** @import { LayoutFunction, PageOutputsFunction } from '#types' */

/** @type {LayoutFunction<object, string, string>} */
export default ({ children, page }) => `<section class="shared-layout" data-compose="${page.compose}">${children}</section>`

/** @type {PageOutputsFunction} */
export const pageOutputs = ({ page }) => {
  if (page.compose) throw new Error('Composition slides must not run layout pageOutputs')
  return {
    outputName: `${page.outputName}.layout.json`,
    content: JSON.stringify({ url: page.url, compose: page.compose }),
  }
}
