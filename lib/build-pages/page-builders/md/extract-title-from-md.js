import markdownit from 'markdown-it'

// Block parsing supplies raw inline content; title extraction never needs inline children.
const md = markdownit().disable('inline')

/**
 * Extract the first H1 heading from markdown using markdown-it's token API
 * @param {string} markdown
 * @returns {string | null}
 */
export function extractFirstH1 (markdown) {
  const tokens = md.parse(markdown, {})

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    // Look for heading_open token with tag 'h1'
    if (token && token.type === 'heading_open' && token.tag === 'h1') {
      // The next token should be inline with the heading content
      const nextToken = tokens[i + 1]
      if (nextToken && nextToken.type === 'inline') {
        // The inline token's content is the raw text of the heading
        return nextToken.content.trim()
      }
    }
  }

  return null
}
