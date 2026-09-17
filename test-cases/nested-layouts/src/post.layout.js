/** @import { LayoutFunction } from '#types' */
export const parentLayout = 'article'
/** @type {LayoutFunction<object, string, { html: string }>} */
export default ({ children }) => ({ html: '<section>' + children + '</section>' })
