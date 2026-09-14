import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hook, setup, settle } from './helpers.js'

for (const full of [false, true]) {
  const mode = full ? 'full' : 'targeted'
  test(`${mode} watch converges owned file to directory and back`, { timeout: 30_000 }, async t => {
    const { site, src, dest, read, mtime, logs } = await setup(t, {
      'page.js': "export default () => 'main'; export const additionalOutputs = ({ vars }) => ({ outputName: vars.rawName, content: 'raw bytes' })",
      'global.vars.js': "export default { layout: 'root', rawName: '/raw' }",
      'page.vars.js': 'export default {}',
    })
    await site.watch({ serve: false })
    const change = async (/** @type {string} */ name) => {
      await settle(site, logs, async () => {
        await writeFile(join(src, full ? 'global.vars.js' : 'page.vars.js'), `export default { layout: 'root', rawName: ${JSON.stringify(name)} }`)
      })
    }
    await change('/raw/article.md')
    assert.equal(await read('raw/article.md'), 'raw bytes')
    const time = await mtime('raw/article.md')
    await change('/raw/article.md')
    assert.equal(await mtime('raw/article.md'), time)
    await change('/raw')
    assert.equal(await read('raw'), 'raw bytes')
    assert.equal((await stat(join(dest, 'raw'))).isFile(), true)
  })

  test(`${mode} watch validates all stale paths before removing any output`, { timeout: 30_000 }, async t => {
    const { site, src, dest, read, logs } = await setup(t, {
      'page.js': "export default () => 'old main'; export const additionalOutputs = () => [{ outputName: '/first.txt', content: 'first' }, { outputName: '/raw/article.md', content: 'owned' }]",
    })
    await site.watch({ serve: false })
    const outside = join(src, '..', 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'article.md'), 'external sentinel')
    await rename(join(dest, 'raw'), join(dest, 'saved-raw'))
    await symlink(outside, join(dest, 'raw'))
    await settle(site, logs, async () => {
      if (full) await rm(join(src, 'page.js'))
      else await writeFile(join(src, 'page.js'), "export default () => 'new main'")
    }, 'symlink')
    assert.ok(logs.some(line => line.includes('symlink')))
    assert.equal(await readFile(join(outside, 'article.md'), 'utf8'), 'external sentinel')
    assert.equal(await read('first.txt'), 'first')
    assert.equal(await read('index.html'), 'old main')
    await rm(join(dest, 'raw'))
    await rename(join(dest, 'saved-raw'), join(dest, 'raw'))
    await settle(site, logs, async () => {
      await writeFile(join(src, 'page.js'), "export default () => 'recovered'; " + hook('/new.txt'))
    })
    assert.equal(await read('new.txt'), 'sidecar')
    for (const name of ['first.txt', 'raw/article.md']) await assert.rejects(stat(join(dest, name)), { code: 'ENOENT' })
  })

  test(`${mode} watch rejects an unowned blocking file before stale cleanup`, { timeout: 30_000 }, async t => {
    const { site, src, dest, read, logs } = await setup(t, {
      'page.js': "export default () => 'main'; export const additionalOutputs = ({ vars }) => ({ outputName: vars.rawName, content: 'owned' })",
      'global.vars.js': "export default { layout: 'root', rawName: '/old.txt' }",
      'page.vars.js': 'export default {}',
    })
    await site.watch({ serve: false })
    await writeFile(join(dest, 'raw'), 'unowned sentinel')
    await settle(site, logs, async () => {
      await writeFile(join(src, full ? 'global.vars.js' : 'page.vars.js'), "export default { layout: 'root', rawName: '/raw/article.md' }")
    }, 'non-directory ancestor')
    assert.ok(logs.some(line => line.includes('non-directory ancestor')))
    assert.equal(await read('raw'), 'unowned sentinel')
    assert.equal(await read('old.txt'), 'owned')
  })
}
