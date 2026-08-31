import { test } from 'node:test'
import assert from 'node:assert'

import { getMd } from './get-md.js'

test('renders GitHub-style Markdown alerts', async () => {
  const md = await getMd()
  const html = md.render('> [!NOTE]\n> TypeScript and JavaScript are both supported.')

  assert.match(html, /class="markdown-alert markdown-alert-note"/)
  assert.match(html, /class="markdown-alert-title"/)
  assert.match(html, />Note</)
  assert.match(html, /TypeScript and JavaScript are both supported\./)
})
