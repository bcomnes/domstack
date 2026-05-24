import { fsPathToUrlPath } from './page-builders/fs-path-to-url.js'

/**
 * Derive the canonical URL path for a page from its filesystem path and output name.
 * Index pages get a trailing-slash URL; other outputs include the filename.
 *
 * @param {object} params
 * @param {string} params.path - The page's directory path relative to src root
 * @param {string} params.outputName - The output filename (e.g. 'index.html' or 'loose-md.html')
 * @returns {string}
 */
export function computePageUrl ({ path, outputName }) {
  if (outputName === 'index.html') {
    return path ? fsPathToUrlPath(path) + '/' : '/'
  }
  return path ? fsPathToUrlPath(path) + '/' + outputName : '/' + outputName
}
