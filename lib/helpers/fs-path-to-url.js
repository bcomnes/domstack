import { sep } from 'path'

/**
 * Convert a path to a URL for the site.
 * @param  {string} fsPath A path from your OS
 * @return {string}        The URL version of the path
 */
export function fsPathToUrlPath (fsPath) {
  return '/' + fsPath.split(sep).join('/')
}
