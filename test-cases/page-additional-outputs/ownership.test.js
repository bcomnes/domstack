import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hook, setup, settle } from './helpers.js'

test('data-invalidated pages replace ownership using actual reports', { timeout: 15_000 }, async t => {
  const { site, src, dest, read, logs } = await setup(t, {
    'global.data.js': "export default { name: 'old.txt' }",
    'page.js': "export const vars = { dataDeps: ['name'] }; export default () => 'main'; export const additionalOutputs = ({ data }) => ({ outputName: data.name, content: 'sidecar' })",
  })
  await site.watch({ serve: false })
  await settle(site, logs, async () => {
    await writeFile(join(src, 'global.data.js'), "export default { name: 'new.txt' }")
  })
  assert.equal(await read('new.txt'), 'sidecar')
  await assert.rejects(stat(join(dest, 'old.txt')), { code: 'ENOENT' })
})

for (const owner of ['page', 'template']) {
  test(`targeted cleanup protects an untouched ${owner} claim`, { timeout: 15_000 }, async t => {
    const { site, src, read, logs } = await setup(t, {
      'page.js': "export default () => 'main'; " + hook('shared.html'),
      ...(owner === 'page'
        ? { 'shared.md': 'other page' }
        : { 'shared.template.js': "export default () => ({ outputName: 'shared.html', content: 'template' })" }),
    })
    await site.watch({ serve: false })
    const shared = await read('shared.html')
    await settle(site, logs, async () => {
      await writeFile(join(src, 'page.js'), "export default () => 'updated main'")
    })
    assert.equal(await read('shared.html'), shared)
  })
}

test('failed direct builds retain successful ownership for recovery', { timeout: 15_000 }, async t => {
  const { site, src, dest, read, logs } = await setup(t, {
    'page.js': "export default () => 'old main'; " + hook('old.txt'),
  })
  await site.watch({ serve: false })
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), `export default () => 'failed main'; export async function* additionalOutputs () {
      yield { outputName: 'partial.txt', content: 'partial' }
      throw Error('ownership failure')
    }`)
  }, 'ownership failure')
  assert.equal(await read('old.txt'), 'sidecar', 'failure must not clean up the previous successful output')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), "export default () => 'recovered'; " + hook('new.txt'))
  })
  assert.equal(await read('new.txt'), 'sidecar')
  await assert.rejects(stat(join(dest, 'old.txt')), { code: 'ENOENT' })
})

test('stale cleanup does not follow symlink ancestors outside dest', { timeout: 15_000 }, async t => {
  const { site, src, dest, logs } = await setup(t, {
    'page.js': "export default () => 'main'; " + hook('nested/owned.txt'),
  })
  await site.watch({ serve: false })
  const outside = join(dest, '..', 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'owned.txt'), 'keep')
  await rm(join(dest, 'nested'), { recursive: true })
  await symlink(outside, join(dest, 'nested'), 'dir')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), "export default () => 'main without hook'")
  })
  assert.equal(await readFile(join(outside, 'owned.txt'), 'utf8'), 'keep')
})
