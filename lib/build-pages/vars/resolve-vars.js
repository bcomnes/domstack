import { isFunction, isPlainObject } from '../../helpers/type-guards.js'

/**
 * Resolve an object-or-function vars export.
 *
 * @param {unknown} maybeVars
 * @param {string} errorLabel
 * @returns {Promise<Record<string, unknown>>}
 */
export async function resolveVarsExport (maybeVars, errorLabel) {
  if (!maybeVars) return {}

  if (isPlainObject(maybeVars)) {
    return maybeVars
  } else if (isFunction(maybeVars)) {
    const resolvedVars = await maybeVars()
    if (isPlainObject(resolvedVars)) return resolvedVars
    throw new Error(`${errorLabel} function must resolve to a plain object`)
  } else {
    return {}
  }
}

/**
 * Resolve variables by importing them from a specified path.
 *
 * @param {object} params
 * @param {string | undefined} [params.varsPath] - Path to the file containing the variables.
 * @param {string} [params.key='default'] - The key to extract from the imported module. Default: 'default'
 * @returns {Promise<object>} - Returns the resolved variables. If the imported variable is a function, it executes and returns its result. Otherwise, it returns the variable directly.
 */
export async function resolveVars ({
  varsPath,
  key = 'default',
}) {
  if (!varsPath) return {}

  const imported = await import(varsPath)
  return await resolveVarsExport(imported[key], 'Var')
}
