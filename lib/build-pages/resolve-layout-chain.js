/**
 * Resolve a named layout and its ancestors in outermost-to-innermost order.
 * Imports are deliberately not consulted: only parentLayout defines nesting.
 *
 * @template {{ name: string, parentLayout?: string | undefined }} L
 * @param {string} name
 * @param {Record<string, L>} layouts
 * @returns {L[]}
 */
export function resolveLayoutChain (name, layouts) {
  /** @type {L[]} */
  const chain = []
  const visited = new Set()
  let current = name

  while (true) {
    const path = [...visited, current].join(' -> ')
    if (visited.has(current)) throw new Error(`Layout cycle: ${path}`)
    if (!Object.hasOwn(layouts, current)) throw new Error(`Unable to resolve layout "${current}" (chain: ${path})`)
    const layout = layouts[current]
    if (!layout) throw new Error(`Unable to resolve layout "${current}"`)
    visited.add(current)
    chain.push(layout)
    if (layout.parentLayout === undefined) break
    current = layout.parentLayout
  }

  return chain.reverse()
}
