/**
 * Resolve the selected layout name without constructing a partial vars object.
 *
 * Layout selection intentionally uses only pre-layout sources to avoid circular
 * dependency on the selected layout's own vars. The lookup preserves the same
 * precedence as the previous spread: builder/page-frontmatter vars, then
 * page.vars, then global vars.
 *
 * @param {object} globalVars
 * @param {object | null} pageVars
 * @param {object | null} builderVars
 * @returns {string}
 */
export function resolveLayoutName (globalVars, pageVars, builderVars) {
  for (const source of [builderVars, pageVars, globalVars]) {
    if (!source || !('layout' in source)) continue
    if (typeof source.layout !== 'string') throw new Error('Layout variable must be a string')
    return source.layout
  }

  throw new Error('Page variables missing a layout var')
}
