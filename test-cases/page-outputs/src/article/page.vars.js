/** @import { PageOutputsFunction } from '#types' */

export default { dataDeps: ['edition'] }

/** @type {PageOutputsFunction<{ title: string }, { edition: string }>} */
export const pageOutputs = ({ page, vars, data }) => ({
  outputName: 'metadata.json',
  content: JSON.stringify({ title: vars.title, url: page.url, edition: data.edition }),
})
