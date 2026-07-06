/**
 * Stable JSON serialization for cache keys, hashes, and generated metadata.
 *
 * Applies JSON's normal serialization rules first, then sorts object keys so
 * semantically equivalent objects produce the same string regardless of property
 * insertion order.
 *
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function stableJsonStringify (value) {
  const serializedValue = JSON.stringify(value)
  return serializedValue === undefined
    ? undefined
    : stableJsonStringifyValue(JSON.parse(serializedValue))
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function stableJsonStringifyValue (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)

  if (Array.isArray(value)) {
    return `[${value.map(item => stableJsonStringifyValue(item) ?? 'null').join(',')}]`
  }

  const serializedProperties = []
  for (const [key, item] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
    const serializedItem = stableJsonStringifyValue(item)
    if (serializedItem !== undefined) {
      serializedProperties.push(`${JSON.stringify(key)}:${serializedItem}`)
    }
  }

  return `{${serializedProperties.join(',')}}`
}
