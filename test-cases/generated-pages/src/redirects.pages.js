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

/** @type {PagesFunction<Record<string, any>, any, { redirects: Redirect[] }>} */
export default function redirectsPages ({ vars }) {
  const pages = []

  for (const { from, to } of vars.redirects) {
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
