import { resolveVarsExport } from '../vars/resolve-vars.js'

/**
 * Load the companion once, retaining live exports for later provider selection.
 * @param {string | undefined} varsPath
 * @returns {Promise<{ vars: Record<string, unknown>, exports: Record<string, unknown> | undefined }>}
 */
export async function resolvePageCompanion (varsPath) {
  if (!varsPath) return { vars: {}, exports: undefined }

  const exports = await import(varsPath)
  const vars = await resolveVarsExport(exports.default, 'Var')
  if (exports.postVars) {
    throw new Error(
      `postVars is no longer supported (found in ${varsPath}). ` +
      'Move data aggregation to a global.data.js file instead. ' +
      'See the domstack docs for details.'
    )
  }
  return { vars, exports }
}
