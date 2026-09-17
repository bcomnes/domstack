/** @import { AsyncLayoutFunction } from '#types' */
export const parentLayout = 'root'
export const vars = async () => ({ overridden: 'article', title: 'article' })
/** @type {AsyncLayoutFunction<object, { html: string }, string>} */
export default async ({ children }) => '<article>' + children.html + '</article>'
