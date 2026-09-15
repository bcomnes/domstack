import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hook, setup, settle } from './helpers.js'
import { startWatch } from '../watch/helpers.js'

test('data-invalidated pages replace ownership using actual reports', { timeout: 15_000 }, async t => {
  const { site, src, dest, read, logs } = await setup(t, {
    'global.data.js': "export default { name: 'old.txt' }",
    'page.js': "export const vars = { dataDeps: ['name'] }; export default () => 'main'; export const pageOutputs = ({ data }) => ({ outputName: data.name, content: 'sidecar' })",
  })
  await startWatch(t, site, src)
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
    await startWatch(t, site, src)
    const shared = await read('shared.html')
    await settle(site, logs, async () => {
      await writeFile(join(src, 'page.js'), "export default () => 'updated main'")
    })
    assert.equal(await read('shared.html'), shared)
  })
}

test('repeated failed watch builds union partial paths with successful ownership for recovery', { timeout: 15_000 }, async t => {
  const { site, src, dest, read, logs } = await setup(t, {
    'page.js': "export default () => 'old main'; " + hook('old.txt'),
  })
  await startWatch(t, site, src)
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), `export default () => 'failed main'; export async function* pageOutputs () {
      yield { outputName: 'partial.txt', content: 'partial' }
      throw Error('ownership failure')
    }`)
  }, 'ownership failure')
  assert.equal(await read('old.txt'), 'sidecar', 'failure must not clean up the previous successful output')
  assert.equal(await read('partial.txt'), 'partial')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), `export default () => 'failed again'; export async function* pageOutputs () {
      yield { outputName: 'second-partial.txt', content: 'second partial' }
      throw Error('second ownership failure')
    }`)
  }, 'second ownership failure')
  assert.equal(await read('index.html'), 'old main')
  assert.equal(await read('old.txt'), 'sidecar')
  assert.equal(await read('partial.txt'), 'partial')
  assert.equal(await read('second-partial.txt'), 'second partial')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), "export default () => 'recovered'; " + hook('new.txt'))
  })
  assert.equal(await read('new.txt'), 'sidecar')
  for (const name of ['old.txt', 'partial.txt', 'second-partial.txt']) {
    await assert.rejects(stat(join(dest, name)), { code: 'ENOENT' })
  }
})

for (const change of ['recovery', 'source deletion', 'hook removal']) {
  test(`initial failed watch tracks partial ownership for ${change}`, { timeout: 15_000 }, async t => {
    const { site, src, dest, read, logs } = await setup(t, {
      'article/page.html': 'Article',
      'article/page.vars.js': `export default {}; export async function* pageOutputs () {
        yield { outputName: 'partial.txt', content: 'partial' }
        yield { outputName: '/root-partial.txt', content: 'root partial' }
        throw Error('initial ownership failure')
      }`,
    })
    const result = await startWatch(t, site, src)
    assert.ok(logs.some(line => JSON.parse(line).msg === 'Build Failed!'))
    assert.ok(logs.some(line => line.includes('initial ownership failure')))
    assert.equal(await read('article/partial.txt'), 'partial')
    assert.equal(await read('root-partial.txt'), 'root partial')
    for (const outputRelname of ['article/partial.txt', 'root-partial.txt']) {
      const record = result.pageBuildResults?.outputs.find(output => output.outputRelname === outputRelname)
      assert.ok(record, `${outputRelname} is included in the failed page build report`)
      assert.equal(record.sourceRelname, 'article/page.html')
      assert.equal(record.filepath, join(dest, outputRelname))
    }
    await assert.rejects(stat(join(dest, 'article/index.html')), { code: 'ENOENT' })
    await settle(site, logs, async () => {
      if (change === 'recovery') await writeFile(join(src, 'article/page.vars.js'), 'export default {}; ' + hook('recovered.txt', 'recovered'))
      if (change === 'source deletion') await rm(join(src, 'article/page.html'))
      if (change === 'hook removal') await writeFile(join(src, 'article/page.vars.js'), 'export default {}')
    })
    for (const name of ['article/partial.txt', 'root-partial.txt']) {
      await assert.rejects(stat(join(dest, name)), { code: 'ENOENT' })
    }
    if (change === 'source deletion') {
      await assert.rejects(stat(join(dest, 'article/index.html')), { code: 'ENOENT' })
    } else {
      assert.equal(await read('article/index.html'), 'Article')
      if (change === 'recovery') assert.equal(await read('article/recovered.txt'), 'recovered')
    }
  })
}

test('stale cleanup does not follow symlink ancestors outside dest', { timeout: 15_000 }, async t => {
  const { site, src, dest, logs } = await setup(t, {
    'page.js': "export default () => 'main'; " + hook('nested/owned.txt'),
  })
  await startWatch(t, site, src)
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
