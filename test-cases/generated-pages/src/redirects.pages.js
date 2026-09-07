/** @import { PagesFunction } from '#types' */

/**
 * @typedef {object} Redirect
 * @property {string} from
 * @property {string} to
 */

/**
 * @param {string} from
 * @returns {string}
 */
function redirectOutputName (from) {
  if (!from.startsWith('/') || from.startsWith('//')) throw new Error(`redirectFrom must be a same-origin URL path: ${from}`)
  if (from.includes('?') || from.includes('#')) throw new Error(`redirectFrom must not include a query or fragment: ${from}`)

  const relativePath = from.slice(1)
  if (relativePath.length === 0) return 'index.html'
  return relativePath.endsWith('/') ? `${relativePath}index.html` : relativePath
}

export const dataDependencies = ['redirects']

/** @type {PagesFunction<Record<string, any>, string, Record<string, any>, { redirects: Redirect[] }>} */
export default function redirectsPages ({ data }) {
  const pages = []

  for (const { from, to } of data.redirects) {
    pages.push({
      outputName: redirectOutputName(from),
      vars: {
        layout: 'redirect',
        title: 'Redirecting...',
        redirectTo: to,
      },
    })
  }

  return pages
}
