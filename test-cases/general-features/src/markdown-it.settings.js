/**
 * @import markdownIt from 'markdown-it'
 */

/**
 * Custom markdown-it settings for testing
 * This adds a custom container for "test-box" that will be used in our test
 */

/**
 * Customize the markdown-it instance
 * @param {InstanceType<typeof markdownIt>} md - The markdown-it instance
 * @returns {Promise<InstanceType<typeof markdownIt>>} - The modified markdown-it instance
 */
export default async function markdownItSettingsOverride (md) {
  // Add custom container for test-box
  md.use(createTestBoxPlugin())
  return md
}

/**
 * Creates a plugin that adds a custom container for test-box
 * This is a simplified version of markdown-it-container
 */
function createTestBoxPlugin () {
  const TEST_BOX_MARKER = 'test-box'

  return (/** @type {InstanceType<typeof markdownIt>} */md) => {
    // @ts-ignore
    const container = (state, startLine, endLine, silent) => {
      let pos = state.bMarks[startLine] + state.tShift[startLine]
      let max = state.eMarks[startLine]

      // Check if the line starts with :::
      if (state.src.charCodeAt(pos) !== 0x3A /* : */ ||
          state.src.charCodeAt(pos + 1) !== 0x3A /* : */ ||
          state.src.charCodeAt(pos + 2) !== 0x3A /* : */) {
        return false
      }

      // Check for TEST_BOX_MARKER after :::
      const match = state.src.slice(pos + 3, max).trim()
      if (match !== TEST_BOX_MARKER) {
        return false
      }

      // Don't process if we're in "silent" mode
      if (silent) {
        return true
      }

      // Find the end marker
      let nextLine = startLine
      let found = false

      while (nextLine < endLine) {
        nextLine++

        // End of document
        if (nextLine >= state.lineMax) {
          break
        }

        // Get positions
        pos = state.bMarks[nextLine] + state.tShift[nextLine]
        max = state.eMarks[nextLine]

        // Blank line, skip
        if (pos >= max) {
          continue
        }

        // End marker check
        if (state.src.charCodeAt(pos) === 0x3A /* : */ &&
            state.src.charCodeAt(pos + 1) === 0x3A /* : */ &&
            state.src.charCodeAt(pos + 2) === 0x3A /* : */ &&
            state.src.slice(pos + 3, max).trim() === '') {
          found = true
          nextLine++
          break
        }
      }

      // Create tokens for the container
      let token = state.push('test_box_open', 'div', 1)
      token.markup = ':::'
      token.block = true
      token.attrs = [['class', 'test-box']]

      // Process content within the container
      state.md.block.tokenize(state, startLine + 1, found ? nextLine - 1 : nextLine)

      token = state.push('test_box_close', 'div', -1)
      token.markup = ':::'
      token.block = true

      state.line = nextLine
      return true
    }

    md.block.ruler.before('fence', 'test_box', container)
  }
}
