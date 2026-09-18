import { createHash } from 'node:crypto'
import { types } from 'node:util'
import { stableJsonStringify } from '../../helpers/stable-json-stringify.js'

// Older supported runtimes need not provide the raw-JSON API.
const isRawJSON = Reflect.get(JSON, 'isRawJSON')
const MAX_FINGERPRINT_SERIALIZATION_DEPTH = 128

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function fingerprint (value) {
  try {
    let serialized
    if (value !== null && typeof value === 'object') {
      // Inherited JSON hooks can transform otherwise ordinary data during serialization.
      const needsLegacy = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') ||
        Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON') ||
        Object.getPrototypeOf(Array.prototype) !== Object.prototype
      serialized = needsLegacy ? undefined : serializeFingerprintValue(value, new Set())
      if (serialized === undefined) {
        if (!isFingerprintSafe(value, new Set())) return null
        serialized = stableJsonStringify(value)
      }
    } else {
      // Primitives are already canonical; preserve JSON escaping without a round-trip.
      if (typeof value === 'number') {
        if (!Number.isFinite(value) || Object.is(value, -0)) return null
      } else if (value !== null && typeof value !== 'string' && typeof value !== 'boolean') {
        return null
      }
      serialized = JSON.stringify(value)
    }
    if (serialized == null) return null
    return createHash('sha256').update(serialized).digest('hex')
  } catch {
    return null
  }
}

/**
 * Validate and serialize ordinary data together, without JSON's intermediate graph.
 * Null means opaque; undefined requests the legacy path before any user hooks run.
 *
 * @param {unknown} value
 * @param {Set<object>} ancestors
 * @returns {string | null | undefined}
 */
function serializeFingerprintValue (value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? JSON.stringify(value) : null
  if (typeof value !== 'object') return null
  // Proxy traps and unusual array prototypes must retain the legacy observation order.
  // Bound recursion so stack-sensitive deep graphs also keep their legacy behavior.
  if (types.isProxy(value) || ancestors.size >= MAX_FINGERPRINT_SERIALIZATION_DEPTH) return undefined
  // JSON also recognizes internal slots, even after an object's prototype changes.
  if (types.isBoxedPrimitive(value) || (typeof isRawJSON === 'function' && isRawJSON(value))) return undefined
  if (ancestors.has(value)) return null
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (array) {
    if (prototype !== Array.prototype && prototype !== null) return undefined
  } else if (prototype !== Object.prototype && prototype !== null) {
    return null
  }

  const keys = Reflect.ownKeys(value)
  ancestors.add(value)
  try {
    if (array) {
      if (keys.length !== value.length + 1) return null
      const items = []
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index)
        if (!descriptor?.enumerable || !('value' in descriptor)) return null
        const item = serializeFingerprintValue(descriptor.value, ancestors)
        if (item == null) return item
        items.push(item)
      }
      return `[${items.join(',')}]`
    }

    /** @type {[string, string][]} */
    const properties = []
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) return null
      const item = serializeFingerprintValue(descriptor.value, ancestors)
      if (item == null) return item
      properties.push([key, item])
    }
    // Match stableJsonStringify's locale ordering, including stable collation ties.
    properties.sort(([a], [b]) => a.localeCompare(b))
    return `{${properties.map(([key, item]) => `${JSON.stringify(key)}:${item}`).join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Reject values whose observable shape JSON serialization would silently lose.
 * A null fingerprint intentionally invalidates subscribers on every build.
 *
 * @param {unknown} value
 * @param {Set<object>} ancestors
 * @returns {boolean}
 */
function isFingerprintSafe (value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) return false
    ancestors.add(value)
    // Check every index explicitly: array iteration skips holes, which could
    // otherwise hide an extra named property behind the own-key count check.
    let safe = true
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index)
      if (!descriptor?.enumerable || !('value' in descriptor) || !isFingerprintSafe(descriptor.value, ancestors)) {
        safe = false
        break
      }
    }
    ancestors.delete(value)
    return safe
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false

  ancestors.add(value)
  const safe = Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) return false
    return isFingerprintSafe(descriptor.value, ancestors)
  })
  ancestors.delete(value)
  return safe
}
