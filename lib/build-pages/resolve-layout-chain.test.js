import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveLayoutChain } from './resolve-layout-chain.js'
import { resolveLayout } from './page-data.js'

test('resolves chains without inferring parents from vars or imports', () => {
  const root = { name: 'root' }
  const article = { name: 'article', parentLayout: 'root' }
  const post = { name: 'post', parentLayout: 'article', vars: { layout: 'unrelated' } }
  const layouts = { root, article, post }
  assert.deepEqual(resolveLayoutChain('post', layouts), [root, article, post])
  assert.deepEqual(resolveLayoutChain('root', layouts), [root])
  assert.equal(post.parentLayout, 'article', 'resolution does not mutate modules')
  assert.throws(() => resolveLayoutChain('missing', layouts), /Unable to resolve layout "missing"/)
  assert.throws(() => resolveLayoutChain('toString', layouts), /Unable to resolve layout "toString"/)
  assert.throws(() => resolveLayoutChain('post', { post }), /post -> article/)
  assert.throws(() => resolveLayoutChain('root', { root: { name: 'root', parentLayout: 'root' } }), /Layout cycle: root -> root/)
  assert.throws(() => resolveLayoutChain('post', {
    post, article: { ...article, parentLayout: 'post' }
  }), /Layout cycle: post -> article -> post/)
})

test('validates the parentLayout and default exports', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'domstack-layout-exports-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const [index, value] of ['null', 'false', '42', "''", "'  '", "['root']", '() => "root"'].entries()) {
    const file = join(dir, `${index}.mjs`)
    await writeFile(file, `export const parentLayout = ${value}; export default () => ''`)
    await assert.rejects(resolveLayout(file), /parentLayout must be a non-empty string/)
  }
  const file = join(dir, 'invalid.mjs')
  await writeFile(file, 'export default 42')
  await assert.rejects(resolveLayout(file), /must export a default render function/)
})
