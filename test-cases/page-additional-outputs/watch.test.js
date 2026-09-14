import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hook, setup, settle, writeFiles } from './helpers.js'

const rawLayout = `export const vars = { dataDeps: ['navigation'] }
export default ({ children, data }) => data.navigation + children
export const additionalOutputs = async ({ page }) => ({ outputName: 'source.txt', content: await page.readMarkdownContent() })`

test('watch updates only changed raw content and retains unchanged ownership without a public manifest', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, mtime, logs } = await setup(t, {
    'global.data.js': "export default { navigation: 'Navigation one' }",
    'root.layout.js': rawLayout,
    'a/page.md': '# Article A\n',
    'b/page.md': '# Article B\n',
  })
  await site.watch({ serve: false })
  const siblingRaw = await mtime('b/source.txt')
  const siblingHtml = await mtime('b/index.html')
  const originalRaw = await mtime('a/source.txt')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'a/page.md'), '# Edited A\n')
  })
  assert.equal(await read('a/source.txt'), '# Edited A\n')
  assert.match(await read('a/index.html'), /Edited A/)
  assert.notEqual(await mtime('a/source.txt'), originalRaw)
  assert.equal(await mtime('b/source.txt'), siblingRaw)
  assert.equal(await mtime('b/index.html'), siblingHtml, 'body edit must not invalidate an unrelated sibling')
  const editedRaw = await mtime('a/source.txt')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'global.data.js'), "export default { navigation: 'Navigation two' }")
  })
  for (const name of ['a', 'b']) assert.match(await read(`${name}/index.html`), /Navigation two/)
  assert.equal(await mtime('a/source.txt'), editedRaw, 'navigation rebuild does not rewrite identical raw content')
  assert.equal(await mtime('b/source.txt'), siblingRaw)
  await settle(site, logs, async () => {
    await rm(join(src, 'b/page.md'))
  })
  await assert.rejects(stat(join(dest, 'b/source.txt')), { code: 'ENOENT' })
  await assert.rejects(stat(join(dest, 'b/index.html')), { code: 'ENOENT' })
  assert.equal(await read('a/source.txt'), '# Edited A\n')
  await assert.rejects(stat(join(dest, 'domstack-manifest.json')), { code: 'ENOENT' })
})

test('watch reconciles companion addition, output rename, hook removal, companion removal and re-addition', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, logs } = await setup(t, { 'article/page.html': '<p>Article</p>' })
  await site.watch({ serve: false })
  const companion = join(src, 'article/page.vars.js')
  await settle(site, logs, async () => {
    await writeFile(companion, 'export default {}; ' + hook('first.txt', 'first'))
  })
  assert.equal(await read('article/first.txt'), 'first')
  await settle(site, logs, async () => {
    await writeFile(companion, 'export default {}; ' + hook('renamed.txt', 'renamed'))
  })
  assert.equal(await read('article/renamed.txt'), 'renamed')
  await assert.rejects(stat(join(dest, 'article/first.txt')), { code: 'ENOENT' })
  await settle(site, logs, async () => {
    await writeFile(companion, 'export default { title: "no hook" }')
  })
  await assert.rejects(stat(join(dest, 'article/renamed.txt')), { code: 'ENOENT' })
  await settle(site, logs, async () => {
    await writeFile(companion, 'export default {}; ' + hook('again.txt'))
  })
  assert.equal(await read('article/again.txt'), 'sidecar')
  await settle(site, logs, async () => {
    await rm(companion)
  })
  await assert.rejects(stat(join(dest, 'article/again.txt')), { code: 'ENOENT' })
  await settle(site, logs, async () => {
    await writeFile(companion, 'export default {}; ' + hook('restored.txt'))
  })
  assert.equal(await read('article/restored.txt'), 'sidecar')
  await settle(site, logs, async () => {
    await rename(companion, join(src, 'article/unassociated.vars.js'))
  })
  await assert.rejects(stat(join(dest, 'article/restored.txt')), { code: 'ENOENT' })
  assert.match(await read('article/index.html'), /Article/)
})

test('watch removes sidecars on source rename and draft exclusion', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, logs } = await setup(t, {
    'root.layout.js': `export default ({ children }) => children
      export const additionalOutputs = async ({ page }) => ({ outputName: page.outputName + '.txt', content: await page.readMarkdownContent() })`,
    'article.md': '# Article\n',
  })
  await site.watch({ serve: false })
  assert.equal(await read('article.html.txt'), '# Article\n')
  await settle(site, logs, async () => {
    await rename(join(src, 'article.md'), join(src, 'renamed.md'))
  })
  assert.equal(await read('renamed.html.txt'), '# Article\n')
  for (const name of ['article.html', 'article.html.txt']) await assert.rejects(stat(join(dest, name)), { code: 'ENOENT' })
  await settle(site, logs, async () => {
    await rename(join(src, 'renamed.md'), join(src, 'renamed.draft.md'))
  })
  for (const name of ['renamed.html', 'renamed.html.txt']) await assert.rejects(stat(join(dest, name)), { code: 'ENOENT' })
  await settle(site, logs, async () => {
    await rename(join(src, 'renamed.draft.md'), join(src, 'renamed.md'))
  })
  assert.equal(await read('renamed.html.txt'), '# Article\n')
})

test('watch iterator failure preserves ownership and recovery removes stale outputs', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, mtime, logs } = await setup(t, {
    'page.js': "export default () => 'old main'; " + hook('old.txt', 'old sidecar'),
  })
  await site.watch({ serve: false })
  const oldTime = await mtime('old.txt')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), `export default () => 'failed main'; export async function* additionalOutputs () {
      yield { outputName: 'old.txt', content: 'failed replacement' }
      yield { outputName: 'partial.txt', content: 'partial' }
      throw Error('watch iterator exploded')
    }`)
  }, 'watch iterator exploded')
  assert.ok(logs.some(line => line.includes('watch iterator exploded')), 'watch reports the hook failure')
  assert.equal(await read('index.html'), 'old main')
  assert.equal(await read('old.txt'), 'old sidecar')
  assert.equal(await mtime('old.txt'), oldTime)
  await assert.rejects(stat(join(dest, 'partial.txt')), { code: 'ENOENT' })
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), "export default () => 'recovered main'; " + hook('new.txt', 'recovered'))
  })
  assert.equal(await read('index.html'), 'recovered main')
  assert.equal(await read('new.txt'), 'recovered')
  await assert.rejects(stat(join(dest, 'old.txt')), { code: 'ENOENT' })
})

for (const change of ['source deletion', 'draft exclusion', 'hook removal', 'companion deletion', 'companion rename']) {
  test(`watch independently cleans up after ${change}`, { timeout: 15_000 }, async t => {
    const { site, src, dest, read, logs } = await setup(t, {
      'article/page.html': 'Article',
      'article/page.vars.js': 'export default {}; ' + hook('owned.txt'),
    })
    await site.watch({ serve: false })
    assert.equal(await read('article/owned.txt'), 'sidecar')
    const page = join(src, 'article/page.html')
    const companion = join(src, 'article/page.vars.js')
    await settle(site, logs, async () => {
      if (change === 'source deletion') await rm(page)
      if (change === 'draft exclusion') await rename(page, join(src, 'article/page.draft.html'))
      if (change === 'hook removal') await writeFile(companion, 'export default {}')
      if (change === 'companion deletion') await rm(companion)
      if (change === 'companion rename') await rename(companion, join(src, 'article/unassociated.vars.js'))
    })
    await assert.rejects(stat(join(dest, 'article/owned.txt')), { code: 'ENOENT' })
    if (change === 'source deletion' || change === 'draft exclusion') {
      await assert.rejects(stat(join(dest, 'article/index.html')), { code: 'ENOENT' })
    } else {
      assert.equal(await read('article/index.html'), 'Article')
    }
  })
}

test('hook-only data subscriptions invalidate their owner but not an unrelated sibling', { timeout: 30_000 }, async t => {
  const { site, src, read, mtime, logs } = await setup(t, {
    'global.data.js': "export default { selected: 'first', unrelated: 'unchanged' }",
    'a/page.html': 'A',
    'a/page.vars.js': "export default { dataDeps: ['selected'] }; export const additionalOutputs = ({ data }) => ({ outputName: 'data.txt', content: data.selected })",
    'b/page.html': 'B',
  })
  await site.watch({ serve: false })
  const mainTime = await mtime('a/index.html')
  const siblingTime = await mtime('b/index.html')
  await settle(site, logs, async () => {
    await writeFiles(src, { 'global.data.js': "export default { selected: 'second', unrelated: 'unchanged' }" })
  })
  assert.equal(await read('a/data.txt'), 'second')
  assert.notEqual(await mtime('a/index.html'), mainTime)
  assert.equal(await mtime('b/index.html'), siblingTime)
})
