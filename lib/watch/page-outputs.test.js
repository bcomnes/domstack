import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hook, setup, settle, writeFiles } from '../build-pages/outputs/test-helpers.js'
import { startWatch } from './test-helpers.js'

const rawLayout = `export const vars = { dataDeps: ['navigation'] }
export default ({ children, data }) => data.navigation + children
export const pageOutputs = async ({ page }) => ({ outputName: 'source.txt', content: await page.readMarkdownContent() })`

test('watch updates only changed raw content and retains unchanged ownership without a public manifest', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, mtime, logs } = await setup(t, {
    'global.data.js': "export default { navigation: 'Navigation one' }",
    'root.layout.js': rawLayout,
    'a/page.md': '# Article A\n',
    'b/page.md': '# Article B\n',
  })
  await startWatch(t, site, src)
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
  await startWatch(t, site, src)
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

test('watch retains output ownership across sessions to remove sidecars renamed while stopped', { timeout: 15_000 }, async t => {
  const { site, src, dest, read } = await setup(t, {
    'article/page.html': '<p>Article</p>',
    'article/page.vars.js': 'export default {}; ' + hook('old.txt', 'old sidecar'),
  })
  await startWatch(t, site, src)
  assert.equal(await read('article/old.txt'), 'old sidecar')

  await site.stopWatching()
  await writeFile(join(src, 'article/page.vars.js'), 'export default {}; ' + hook('new.txt', 'new sidecar'))
  assert.equal(await read('article/old.txt'), 'old sidecar', 'cleanup waits until the next watch session')

  await startWatch(t, site, src)
  assert.equal(await read('article/new.txt'), 'new sidecar')
  assert.match(await read('article/index.html'), /Article/)
  await assert.rejects(stat(join(dest, 'article/old.txt')), { code: 'ENOENT' })
})

test('watch removes sidecars on source rename and draft exclusion', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, logs } = await setup(t, {
    'root.layout.js': `export default ({ children }) => children
      export const pageOutputs = async ({ page }) => ({ outputName: page.outputName + '.txt', content: await page.readMarkdownContent() })`,
    'article.md': '# Article\n',
  })
  await startWatch(t, site, src)
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

test('watch hook failure retains partial writes and recovery removes old and partial outputs', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, mtime, logs } = await setup(t, {
    'page.js': `export default () => 'old main'; export const pageOutputs = () => [
      { outputName: 'old.txt', content: 'old sidecar' },
      { outputName: 'stale.txt', content: 'retain until recovery' },
    ]`,
  })
  await startWatch(t, site, src)
  const oldHtmlTime = await mtime('index.html')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), `export default () => 'failed main'; export async function* pageOutputs () {
      yield { outputName: 'old.txt', content: 'failed replacement' }
      yield { outputName: 'partial.txt', content: 'partial' }
      throw Error('watch iterator exploded')
    }`)
  }, 'watch iterator exploded')
  assert.ok(logs.some(line => line.includes('watch iterator exploded')), 'watch reports the hook failure')
  assert.equal(await read('index.html'), 'old main')
  assert.equal(await mtime('index.html'), oldHtmlTime)
  assert.equal(await read('old.txt'), 'failed replacement')
  assert.equal(await read('partial.txt'), 'partial')
  assert.equal(await read('stale.txt'), 'retain until recovery')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), "export default () => 'recovered main'; " + hook('new.txt', 'recovered'))
  })
  assert.equal(await read('index.html'), 'recovered main')
  assert.equal(await read('new.txt'), 'recovered')
  for (const name of ['old.txt', 'stale.txt', 'partial.txt']) {
    await assert.rejects(stat(join(dest, name)), { code: 'ENOENT' })
  }
})

for (const change of ['source deletion', 'draft exclusion', 'hook removal', 'companion deletion', 'companion rename']) {
  test(`watch independently cleans up after ${change}`, { timeout: 15_000 }, async t => {
    const { site, src, dest, read, logs } = await setup(t, {
      'article/page.html': 'Article',
      'article/page.vars.js': 'export default {}; ' + hook('owned.txt'),
    })
    await startWatch(t, site, src)
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

test('provider precedence warnings reach the configured logger on initial and incremental watch builds', { timeout: 15_000 }, async t => {
  const { site, src, read, logs } = await setup(t, {
    'page.js': "export default () => 'initial'; " + hook('selected.txt', 'page module'),
    'page.vars.js': "export default {}; export const pageOutputs = () => { throw Error('ignored companion ran') }",
  })
  const result = await startWatch(t, site, src)
  assert.equal(result.pageBuildResults?.warnings.filter(warning => 'code' in warning && warning.code === 'DOM_STACK_WARNING_DUPLICATE_PAGE_OUTPUTS_PROVIDER').length, 1)
  const cursor = logs.length
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), "export default () => 'rebuilt'; " + hook('selected.txt', 'page module'))
  })
  for (const messages of [logs.slice(0, cursor), logs.slice(cursor)]) {
    const warnings = messages.map(line => JSON.parse(line)).filter(entry => entry.level === 40 && entry.msg.includes('both export pageOutputs'))
    assert.ok(warnings.length > 0, 'the configured logger receives provider warnings for this watch phase')
    for (const warning of warnings) {
      assert.ok(warning.msg.includes(join(src, 'page.js')))
      assert.ok(warning.msg.includes(join(src, 'page.vars.js')))
    }
  }
  assert.equal(await read('index.html'), 'rebuilt')
  assert.equal(await read('selected.txt'), 'page module')
})

test('hook-only data subscriptions invalidate their owner but not an unrelated sibling', { timeout: 30_000 }, async t => {
  const { site, src, read, mtime, logs } = await setup(t, {
    'global.data.js': "export default { selected: 'first', unrelated: 'unchanged' }",
    'a/page.html': 'A',
    'a/page.vars.js': "export default { dataDeps: ['selected'] }; export const pageOutputs = ({ data }) => ({ outputName: 'data.txt', content: data.selected })",
    'b/page.html': 'B',
  })
  await startWatch(t, site, src)
  const mainTime = await mtime('a/index.html')
  const siblingTime = await mtime('b/index.html')
  await settle(site, logs, async () => {
    await writeFiles(src, { 'global.data.js': "export default { selected: 'second', unrelated: 'unchanged' }" })
  })
  assert.equal(await read('a/data.txt'), 'second')
  assert.notEqual(await mtime('a/index.html'), mainTime)
  assert.equal(await mtime('b/index.html'), siblingTime)
})
