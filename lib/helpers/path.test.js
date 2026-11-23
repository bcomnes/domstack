import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { assertInsideDest, containsPath, resolveCanonicalPath } from './path.js'

test('containsPath checks path components, not string prefixes', () => {
  const output = resolve('public')
  assert.equal(containsPath(output, output), true)
  assert.equal(containsPath(output, join(output, 'docs', 'index.html')), true)
  assert.equal(containsPath(output, join(output, '..notes')), true)
  assert.equal(containsPath(output, resolve('public-old', 'index.html')), false)
  assert.equal(containsPath(output, resolve('other', 'index.html')), false)
  assert.equal(containsPath(output, resolve('.')), false)
  assert.throws(() => assertInsideDest(output, resolve('public-old'), 'outside output'), /outside output/)
})

test('resolveCanonicalPath preserves missing components through a symlink', async t => {
  const root = await mkdtemp(join(tmpdir(), 'domstack-canonical-path-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, 'target')
  const alias = join(root, 'alias')
  await mkdir(target)
  await symlink(target, alias, 'junction')

  assert.equal(await resolveCanonicalPath(join(alias, 'future', 'index.html')), join(await realpath(target), 'future', 'index.html'))
  await rm(target, { recursive: true })
  await assert.rejects(resolveCanonicalPath(join(alias, 'future')), { code: 'ENOENT' })
})
