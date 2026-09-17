/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { DomStackWarning } from '../../helpers/domstack-warning.js'
 * @import { PageOutputsFunction } from './page-outputs.js'
 * @import { PageOutputProvider } from './collect-page-outputs.js'
 */
import { validatePageOutputsHook } from './page-outputs.js'

/**
 * Select a provider without invoking it, validating even an overridden companion hook.
 * @template {Record<string, any>} T
 * @param {PageInfo} pageInfo
 * @param {PageOutputsFunction<T, any> | undefined} pageOutputs
 * @param {Record<string, unknown> | undefined} companionExports
 * @returns {{ provider?: PageOutputProvider<T>, warning?: DomStackWarning | undefined }}
 */
export function resolvePageOutputProvider (pageInfo, pageOutputs, companionExports) {
  if (pageInfo.generated) return {}

  const pageHook = pageInfo.type === 'js' ? pageOutputs : undefined
  const companionPath = pageInfo.pageVars?.filepath
  const companionHook = companionPath
    ? validatePageOutputsHook(companionExports?.['pageOutputs'], companionPath)
    : undefined
  const hook = pageHook ?? companionHook
  if (!hook) return {}

  return {
    provider: {
      hook,
      provenance: {
        kind: pageHook ? 'page' : 'companion',
        source: pageHook ? pageInfo.pageFile.filepath : /** @type {string} */ (companionPath),
      },
    },
    warning: pageHook && companionHook
      ? {
          code: 'DOM_STACK_WARNING_DUPLICATE_PAGE_OUTPUTS_PROVIDER',
          message: `Page "${pageInfo.pageFile.filepath}" and companion "${companionPath}" both export pageOutputs; using the page module export and ignoring the companion export`,
        }
      : undefined,
  }
}
