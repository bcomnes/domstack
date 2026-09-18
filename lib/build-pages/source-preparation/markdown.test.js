/** @import { TestContext } from 'node:test' */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import markdownIt from 'markdown-it'
import { prepareMarkdown } from './markdown.js'

/** @param {TestContext} t */
async function fixture (t) {
  const root = await mkdtemp(join(tmpdir(), 'domstack-source-preparation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const filepath = join(root, 'page.md')
  return {
    filepath,
    /** @param {string} source */
    async prepare (source) {
      await writeFile(filepath, source)
      return prepareMarkdown(filepath)
    },
  }
}

test('explicit frontmatter titles retain every override and skip title parsing', async t => {
  const { prepare } = await fixture(t)
  const parse = t.mock.method(markdownIt.prototype, 'parse')
  for (const [yaml, expected] of [
    ['title: Custom', 'Custom'], ['title: ""', ''], ['title: null', null],
    ['title:', null], ['title: false', false], ['title: 0', 0],
  ]) {
    const prepared = await prepare(`---\n${yaml}\n---\n# Inferred title\n`)
    assert.equal(prepared.vars['title'], expected)
    assert.equal(prepared.markdownContent, '\n# Inferred title\n')
  }
  assert.equal(parse.mock.callCount(), 0)
})

test('missing titles infer H1 without changing scalar or empty frontmatter semantics', async t => {
  const { prepare } = await fixture(t)
  const parse = t.mock.method(markdownIt.prototype, 'parse')
  for (const yaml of ['', 'description: Example', 'null', '42', '[]']) {
    assert.equal((await prepare(`---\n${yaml}\n---\n# Heading with **bold**\n`)).vars['title'], 'Heading with **bold**')
  }
  assert.equal(parse.mock.callCount(), 5)
  assert.deepEqual(await prepare('No heading'), { markdownContent: 'No heading', vars: { title: null } })
  assert.deepEqual((await prepare('---\nhello\n---\n# H1')).vars, { title: 'H1', 0: 'h', 1: 'e', 2: 'l', 3: 'l', 4: 'o' })
})

test('preparation preserves YAML 1.1 values, aliases, cycles, dates and binary', async t => {
  const { prepare } = await fixture(t)
  const prepared = await prepare(`---
flag: yes
number: 012
date: 2026-09-17
binary: !!binary AQID
nested: &nested
  list: [one, two]
  self: *nested
alias: *nested
---
# First title

---
# Second title
`)
  const vars = prepared.vars
  assert.equal(vars['title'], 'First title')
  assert.equal(vars['flag'], true)
  assert.equal(vars['number'], 10)
  assert.deepEqual(vars['date'], new Date('2026-09-17'))
  assert.deepEqual(vars['binary'], new Uint8Array([1, 2, 3]))
  assert.equal(vars['nested'], vars['alias'])
  assert.equal(vars['nested'].self, vars['nested'])
  assert.equal(prepared.markdownContent, '\n# First title\n\n---\n# Second title\n')
})

test('preparation preserves file and YAML errors', async t => {
  const { prepare, filepath } = await fixture(t)
  await assert.rejects(prepareMarkdown(filepath), { code: 'ENOENT' })
  await assert.rejects(prepare('---\nbroken: [\n---\n# Heading'), { name: 'YAMLException' })
})
