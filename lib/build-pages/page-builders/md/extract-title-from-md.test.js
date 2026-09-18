import { test } from 'node:test'
import assert from 'node:assert/strict'
import markdownit from 'markdown-it'

import { extractFirstH1 } from './extract-title-from-md.js'

const originalParser = markdownit()

/**
 * Keep the original full-parser extraction as a differential oracle.
 * @param {string} markdown
 * @returns {string | null}
 */
function extractOriginalFirstH1 (markdown) {
  const tokens = originalParser.parse(markdown, {})
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token && token.type === 'heading_open' && token.tag === 'h1') {
      const nextToken = tokens[i + 1]
      if (nextToken && nextToken.type === 'inline') {
        return nextToken.content.trim()
      }
    }
  }
  return null
}

/** @type {[string, string, string | null][]} */
const cases = [
  ['basic ATX', '# Simple Heading', 'Simple Heading'],
  ['ATX whitespace', '#    Extra Spaces   ', 'Extra Spaces'],
  ['ATX tab separator', '#\tTabbed', 'Tabbed'],
  ['ATX closing hashes', '# Title ###  ', 'Title'],
  ['literal trailing hashes', '# Title###', 'Title###'],
  ['missing ATX separator', '#Not a heading', null],
  ['H1 after other blocks', 'Intro\n\n## H2\n# Title\n### H3', 'Title'],
  ['empty ATX wins over later H1', '#\n\n# Later', ''],
  ['empty ATX with closing hashes', '# ###', ''],
  ['basic Setext', 'Simple Heading\n==============', 'Simple Heading'],
  ['single-character Setext underline', 'Title\n=', 'Title'],
  ['short Setext underline', 'Title\n==', 'Title'],
  ['Setext whitespace', '  Trimmed Heading  \n==============', 'Trimmed Heading'],
  ['Setext after a paragraph', 'Intro\n\nTitle\n===\n\nBody', 'Title'],
  ['multiline Setext', 'First line\nsecond line\n===', 'First line\nsecond line'],
  ['Setext hard break', 'First line  \nsecond line\n===', 'First line  \nsecond line'],
  ['Setext escaped line break', 'First line\\\nsecond line\n===', 'First line\\\nsecond line'],
  ['empty Setext', '\n========', null],
  ['Setext H2', 'Not H1\n---', null],
  ['short Setext H2', 'Not H1\n--', null],
  ['first ATX', '# First\n# Second', 'First'],
  ['first Setext', 'First\n===\n\nSecond\n===', 'First'],
  ['ATX before Setext', '# First\n\nSecond\n===', 'First'],
  ['Setext before ATX', 'First\n===\n\n# Second', 'First'],
  ['blockquote ATX', '> # Quoted\n\n# Outside', 'Quoted'],
  ['nested blockquote Setext', '> > First\n> > second\n> > ===', 'First\nsecond'],
  ['unordered list ATX', '- # Listed\n\n# Outside', 'Listed'],
  ['ordered list Setext', '1. Listed\n   ===', 'Listed'],
  ['nested list and quote', '- item\n  - > # Nested', 'Nested'],
  ['list code block', '- item\n\n      # Code\n\n# Outside', 'Outside'],
  ['backtick fence', '```md\n# Fake\nFake Setext\n===\n```\n\n# Real', 'Real'],
  ['tilde fence', '~~~\n# Fake\n~~~', null],
  ['unclosed fence', '```\n# Fake\n\nTitle\n===', null],
  ['shorter closing fence', '````\n# Fake\n```\n# Still fake\n````\n# Real', 'Real'],
  ['fence inside blockquote', '> ```\n> # Fake\n> ```\n> # Real', 'Real'],
  ['three-space ATX indentation', '   # Title', 'Title'],
  ['four-space code indentation', '    # Code block heading', null],
  ['tab-indented code', '\t# Code block heading', null],
  ['indented Setext code', '    Title\n    ===', null],
  ['heading after indented code', '    # Fake\n\n# Real', 'Real'],
  ['raw emphasis', '# Heading with **bold** and *italic*', 'Heading with **bold** and *italic*'],
  ['raw Setext emphasis', '**Bold** and *italic*\n===', '**Bold** and *italic*'],
  ['raw links and images', '# [link](/url) ![alt](/image)', '[link](/url) ![alt](/image)'],
  ['reference defined after H1', '# [Title][ref]\n\n[ref]: /target "Label"', '[Title][ref]'],
  ['reference defined before H1', '[ref]: /target\n\n# [ref][] and [ref]', '[ref][] and [ref]'],
  ['reference before Setext', '[ref]: /target\n[Title][ref]\n===', '[Title][ref]'],
  ['reference containing a hash', '[ref]: /target "# Not a heading"', null],
  ['unresolved reference', '# [Missing][ref]', '[Missing][ref]'],
  ['raw entities', '# A &amp; B &#35; &#x41;', 'A &amp; B &#35; &#x41;'],
  ['raw escapes', '# \\*literal\\* \\# hash', '\\*literal\\* \\# hash'],
  ['escaped closing hash', '# Title \\#', 'Title \\#'],
  ['escaped heading marker', '\\# Not H1', null],
  ['raw code and autolink', '# `a & b` <https://example.com>', '`a & b` <https://example.com>'],
  ['raw inline HTML', '# <em>Title</em>', '<em>Title</em>'],
  ['frontmatter-like blocks', '---\ntitle: Frontmatter Title\n---\n\n# Actual H1 Title', 'Actual H1 Title'],
  ['empty document', '', null],
  ['whitespace document', ' \t\n\n', null],
  ['no H1', 'Paragraph\n\n## Only H2\n### Only H3', null],
  ['table cells are not headings', '| Title |\n| --- |\n| # Fake |', null],
  ['CRLF normalization', 'Intro\r\n\r\nFirst\r\nsecond\r\n===', 'First\nsecond'],
  ['CR normalization', 'First\rsecond\r===', 'First\nsecond'],
  ['null character normalization', '# Before\0after', 'Before\uFFFDafter'],
]

test.describe('extractFirstH1 known expectations and original-parser equivalence', () => {
  for (const [name, markdown, expected] of cases) {
    test(name, () => {
      const actual = extractFirstH1(markdown)
      assert.equal(actual, expected)
      assert.equal(actual, extractOriginalFirstH1(markdown), 'matches original full parsing')
    })
  }
})

test('extractFirstH1 matches original parsing across block contexts', () => {
  const headings = [
    '# Title',
    '#',
    'First line\nsecond line\n===',
    '# **Bold** &amp; \\*escaped\\* `code`',
    '# [Reference][ref] and ![Image][ref]',
    '[ref]: /target\n[Reference][ref]\n===',
    '## Not H1',
  ]
  const contexts = [
    { name: 'document', prefix: '', suffix: '' },
    { name: 'blockquote', prefix: '> ', suffix: '' },
    { name: 'nested blockquote', prefix: '> > ', suffix: '' },
    { name: 'list continuation', prefix: '  ', suffix: '', before: '- item\n\n' },
    { name: 'quoted list continuation', prefix: '>   ', suffix: '', before: '> - item\n>\n' },
    { name: 'indented code', prefix: '    ', suffix: '' },
    { name: 'fenced code', prefix: '', suffix: '\n```', before: '```md\n' },
    { name: 'unclosed fence', prefix: '', suffix: '', before: '~~~\n' },
    { name: 'table cell', prefix: '| ', suffix: ' |', before: '| Column |\n| --- |\n' },
  ]

  for (const heading of headings) {
    for (const context of contexts) {
      const block = heading.split('\n').map(line => context.prefix + line).join('\n')
      const markdown = `${context.before || ''}${block}${context.suffix}\n\n[ref]: /target\n\n# Fallback\n\nLater Setext\n===`
      for (const newline of ['\n', '\r\n']) {
        const input = markdown.replaceAll('\n', newline)
        assert.equal(extractFirstH1(input), extractOriginalFirstH1(input), `${context.name}: ${JSON.stringify(input)}`)
      }
    }
  }
})
