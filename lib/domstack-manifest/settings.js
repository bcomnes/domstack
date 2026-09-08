/**
 * @import { DomStackOpts } from '../builder.js'
 * @import { DomstackManifestOptions, DomstackManifestTransform, DomstackManifestPolicyTransform, DomstackManifestBuiltHook } from './schema.js'
 */
import { resolveVars } from '../build-pages/resolve-vars.js'
import { isFunction, isPlainObject } from '../helpers/type-guards.js'

/**
 * @param {object} params
 * @param {string | undefined} params.domstackManifestSettingsPath
 * @param {DomStackOpts | undefined} params.opts
 * @returns {Promise<DomstackManifestOptions>}
 */
export async function resolveDomstackManifestOptions ({ domstackManifestSettingsPath, opts }) {
  const domstackManifestOpts = typeof opts?.domstackManifest === 'object'
    ? opts.domstackManifest
    : {}
  const domstackManifestSettings = /** @type {Partial<DomstackManifestOptions>} */ (await resolveVars({
    varsPath: domstackManifestSettingsPath,
  }))
  const includeEntryValue = domstackManifestSettings.includeEntry ?? domstackManifestOpts.includeEntry
  const includeEntry = isFunction(includeEntryValue)
    ? /** @type {DomstackManifestOptions['includeEntry']} */ (includeEntryValue)
    : undefined
  const manifestVars = normalizeManifestFieldSetting(domstackManifestSettings.manifestVars ?? domstackManifestOpts.manifestVars)
  const policy = normalizeManifestPolicySetting(domstackManifestSettings.policy ?? domstackManifestOpts.policy)
  /** @type {DomstackManifestOptions} */
  const options = {
    exclude: [
      ...toStringArray(domstackManifestOpts.exclude),
      ...toStringArray(domstackManifestSettings.exclude),
    ],
  }

  const hooks = mergeManifestHooks(domstackManifestOpts.hooks, domstackManifestSettings.hooks)

  if (includeEntry) options.includeEntry = includeEntry
  if (manifestVars) options.manifestVars = manifestVars
  if (policy) options.policy = policy
  if (hooks) options.hooks = hooks

  return options
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function toStringArray (value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string')
    : []
}

/**
 * @param {unknown} value
 * @returns {DomstackManifestOptions['manifestVars'] | undefined}
 */
function normalizeManifestFieldSetting (value) {
  if (isFunction(value)) return /** @type {DomstackManifestTransform} */ (value)
  const allowlist = toStringArray(value)
  return allowlist.length > 0 ? allowlist : undefined
}

/**
 * @param {unknown} value
 * @returns {DomstackManifestOptions['policy'] | undefined}
 */
function normalizeManifestPolicySetting (value) {
  if (isFunction(value)) return /** @type {DomstackManifestPolicyTransform} */ (value)
  return isPlainObject(value) ? value : undefined
}

/**
 * @param {DomstackManifestOptions['hooks'] | undefined} first
 * @param {DomstackManifestOptions['hooks'] | undefined} second
 * @returns {DomstackManifestOptions['hooks'] | undefined}
 */
function mergeManifestHooks (first, second) {
  const manifestBuilt = [
    ...toFunctionArray(first?.manifestBuilt),
    ...toFunctionArray(second?.manifestBuilt),
  ]

  return manifestBuilt.length > 0 ? { manifestBuilt } : undefined
}

/**
 * @param {unknown} value
 * @returns {DomstackManifestBuiltHook[]}
 */
function toFunctionArray (value) {
  return Array.isArray(value)
    ? /** @type {DomstackManifestBuiltHook[]} */ (value.filter(isFunction))
    : []
}

/**
 * @param {object} params
 * @param {string | undefined} params.domstackManifestSettingsPath
 * @param {DomStackOpts | undefined} params.opts
 */
export function isDomstackManifestEnabled ({ domstackManifestSettingsPath, opts }) {
  return Boolean(domstackManifestSettingsPath || opts?.domstackManifest)
}

/**
 * @param {DomStackOpts | undefined} opts
 */
export function shouldWriteDomstackManifest (opts) {
  if (opts?.domstackManifest === true) return true
  return typeof opts?.domstackManifest === 'object' && opts.domstackManifest.write === true
}
