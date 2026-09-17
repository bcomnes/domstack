import { test } from 'node:test'
import assert from 'node:assert'

import { getMd, renderMd } from './get-md.js'

test('registers the typed Markdown plugins', async () => {
  const md = await getMd()
  const cases = [
    { source: 'H~2~O', expected: /H<sub>2<\/sub>O/ },
    { source: 'x^2^', expected: /x<sup>2<\/sup>/ },
    { source: 'Term\n: Definition', expected: /<dl>[\s\S]*<dt>Term<\/dt>[\s\S]*<dd>Definition<\/dd>/ },
    { source: ':smile:', expected: /😄/ },
    { source: '++inserted++', expected: /<ins>inserted<\/ins>/ },
    { source: '==marked==', expected: /<mark>marked<\/mark>/ },
    { source: '*[HTML]: Hyper Text Markup Language\n\nHTML', expected: /<abbr title="Hyper Text Markup Language">HTML<\/abbr>/ },
    { source: '- [x] Done', expected: /class="task-list-item-checkbox" checked=""/ },
    { source: '# Heading', expected: /<h1 id="heading"/ },
    { source: '# Heading {#custom-heading}', expected: /<h1 id="custom-heading"/ },
    { source: 'Footnote[^1]\n\n[^1]: Note', expected: /class="footnote-ref"/ },
    { source: '```js\nconst answer = 42\n```', expected: /<span class="hljs-keyword">const<\/span>/ },
  ]

  for (const { source, expected } of cases) {
    assert.match(md.render(source), expected, source)
  }
})

test('includes only the configured heading levels in the table of contents', async () => {
  const md = await getMd()
  const html = md.render('[[toc]]\n\n# First\n\n## Second\n\n### Third\n\n#### Fourth')
  assert.match(html, /class="table-of-contents"/)
  for (const name of ['first', 'second', 'third']) {
    assert.ok(html.includes(`href="#${name}"`))
  }
  assert.ok(!html.includes('href="#fourth"'))
})

test('renders Handlebars only when enabled in page vars', async () => {
  const source = '{{vars.title}}'
  assert.equal(await renderMd(source, { vars: { title: 'Example', handlebars: true } }), '<p>Example</p>\n')
  assert.equal(await renderMd(source, { vars: { title: 'Example', handlebars: false } }), '<p>{{vars.title}}</p>\n')
  assert.equal(await renderMd(source, {}), '<p>{{vars.title}}</p>\n')
})

test('renders GitHub-style Markdown alerts', async () => {
  const md = await getMd()
  const html = md.render('> [!NOTE]\n> TypeScript and JavaScript are both supported.')

  assert.match(html, /class="markdown-alert markdown-alert-note"/)
  assert.match(html, /class="markdown-alert-title"/)
  assert.match(html, />Note</)
  assert.match(html, /TypeScript and JavaScript are both supported\./)
})
