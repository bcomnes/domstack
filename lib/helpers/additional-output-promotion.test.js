/** @import { TestContext } from 'node:test' */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareAdditionalOutputPromotion } from './additional-output-promotion.js'
import { assertInsideDest } from './path.js'

/** @param {TestContext} t */
async function fixture (t) {
  const root = await mkdtemp(join(tmpdir(), 'additional-promotion-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dest = join(root, 'dest')
  await mkdir(dest)
  const filepath = join(root, 'staged')
  await writeFile(filepath, Buffer.from([0, 255, 1]))
  const output = { kind: /** @type {const} */ ('page-additional'), outputRelname: 'feed.bin', filepath }
  return { root, dest, filepath, output }
}

test('validates stale paths without sidecars and permits only owned regular blockers', async t => {
  const { root, dest, output } = await fixture(t)
  await writeFile(join(dest, 'raw'), 'old')
  const nested = { ...output, outputRelname: 'raw/article.md' }
  await assert.rejects(prepareAdditionalOutputPromotion(dest, [nested]), { code: 'ENOTDIR' })
  await assert.rejects(prepareAdditionalOutputPromotion(dest, [nested], ['other']), { code: 'ENOTDIR' })
  assert.deepEqual(await prepareAdditionalOutputPromotion(dest, [nested], ['raw']), new Set())
  await symlink(root, join(dest, 'unsafe'))
  await assert.rejects(prepareAdditionalOutputPromotion(dest, [], ['raw', 'unsafe/stale']), /symlink/)
  await assert.rejects(prepareAdditionalOutputPromotion(dest, [], ['../escape']), /escapes dest/)
  await assert.rejects(prepareAdditionalOutputPromotion(dest, [{ ...output, outputRelname: 'unsafe/new' }], ['unsafe']), /symlink/)
  const alias = join(root, 'alias')
  await symlink(dest, alias)
  assert.deepEqual(await prepareAdditionalOutputPromotion(alias, [], ['raw']), new Set())
  assert.doesNotThrow(() => assertInsideDest(dest, join(dest, '..hidden')))
  assert.throws(() => assertInsideDest(dest, join(dest, '../hidden')), /escapes dest/)
})

test('compares exact bytes only for sidecars, allowing missing destinations', async t => {
  const { dest, output } = await fixture(t)
  assert.deepEqual(await prepareAdditionalOutputPromotion(dest, [output]), new Set())
  await writeFile(join(dest, 'feed.bin'), Buffer.from([0, 255, 1]))
  assert.deepEqual(await prepareAdditionalOutputPromotion(dest, [output]), new Set(['feed.bin']))
  assert.deepEqual(await prepareAdditionalOutputPromotion(dest, [{ ...output, kind: 'page' }]), new Set())
  await writeFile(join(dest, 'feed.bin'), Buffer.from([0, 254, 1]))
  assert.deepEqual(await prepareAdditionalOutputPromotion(dest, [output]), new Set())
})

test('allows realpath destination root but rejects leaf, ancestor and dangling symlinks', async t => {
  const { root, dest, output } = await fixture(t)
  const alias = join(root, 'alias')
  await symlink(dest, alias)
  await writeFile(join(dest, 'feed.bin'), Buffer.from([0, 255, 1]))
  assert.deepEqual(await prepareAdditionalOutputPromotion(alias, [output]), new Set(['feed.bin']))
  for (const [name, target] of /** @type {[string, string][]} */ ([['leaf', output.filepath], ['inside', dest], ['outside', root], ['dangling', join(root, 'absent')]])) {
    await symlink(target, join(dest, name))
    await assert.rejects(prepareAdditionalOutputPromotion(dest, [{ ...output, outputRelname: name }]), /symlink/)
    await assert.rejects(prepareAdditionalOutputPromotion(dest, [{ ...output, outputRelname: `${name}/child` }]), /symlink/)
  }
})

test('validates all paths before comparison and rejects escapes', async t => {
  const { root, dest, output } = await fixture(t)
  await symlink(root, join(dest, 'unsafe'))
  await assert.rejects(prepareAdditionalOutputPromotion(dest, [
    { ...output, filepath: join(root, 'missing-source') },
    { ...output, outputRelname: 'unsafe/file' },
  ]), /symlink/)
  for (const outputRelname of ['../escape', dest, '.']) {
    await assert.rejects(prepareAdditionalOutputPromotion(dest, [{ ...output, outputRelname }]), /escapes dest/)
  }
})

test('directory targets remain changed for owned-descendant cleanup; other errors propagate', async t => {
  const { root, dest, output } = await fixture(t)
  await mkdir(join(dest, 'feed.bin'))
  assert.deepEqual(await prepareAdditionalOutputPromotion(dest, [output]), new Set())
  await writeFile(join(dest, 'parent'), '')
  await assert.rejects(prepareAdditionalOutputPromotion(dest, [{ ...output, outputRelname: 'parent/file' }]), { code: 'ENOTDIR' })
  await assert.rejects(prepareAdditionalOutputPromotion(dest, [{ ...output, outputRelname: 'missing', filepath: join(root, 'absent') }]), { code: 'ENOENT' })
  await assert.rejects(prepareAdditionalOutputPromotion(dest, [{ ...output, outputRelname: 'missing', filepath: dest }]), { code: 'EISDIR' })
})
