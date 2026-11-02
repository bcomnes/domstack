/** @import { PageOutputsFunction } from '#types' */

export default {}

/** @type {PageOutputsFunction<{ title: string }>} */
export const pageOutputs = ({ page, vars }) => {
  if (page.compose) throw new Error('Explicit rendering must not run automatic slide pageOutputs')
  return {
    outputName: `${page.outputName}.slide.json`,
    content: JSON.stringify({ title: vars.title }),
  }
}
