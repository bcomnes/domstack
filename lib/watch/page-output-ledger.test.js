/**
 * @import { TestContext } from 'node:test'
 * @import { PageReport, WorkerBuildStepResult } from '../build-pages/index.js'
 * @import { PageOutputCache } from '../build-pages/page-builders/page-output-writer.js'
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PageOutputLedger } from './page-output-ledger.js'

/** @param {TestContext} t */
async function fixture (t) {
  const root = await mkdtemp(join(tmpdir(), 'domstack-output-ledger-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dest = join(root, 'public')
  await mkdir(dest)
  const ledger = new PageOutputLedger(dest)

  /** @param {string} name @returns {DomstackManifestRecord} */
  const output = name => ({ outputRelname: name, filepath: resolve(dest, name), kind: 'page-output', url: `/${name}` })
  /** @param {string} owner @param {string[]} names @returns {PageReport} */
  const page = (owner, names) => ({ sourcePageFilePath: join(root, owner), pageFilePath: resolve(dest, names[0] ?? 'index.html'), layoutNames: [], outputs: names.map(output) })
  /** @param {string[]} names @returns {PageOutputCache} */
  const cache = names => new Map(names.map(name => [resolve(dest, name), { hash: name, metadata: name }]))
  /** @param {string[]} names */
  async function write (names) {
    for (const name of names) {
      const path = resolve(dest, name)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, name)
    }
  }
  return { root, dest, ledger, output, page, cache, write }
}

/**
 * @param {PageReport[]} [pages]
 * @param {Partial<WorkerBuildStepResult['report']>} [report]
 * @returns {Pick<WorkerBuildStepResult, 'report' | 'outputs'>}
 */
function result (pages = [], report = {}) {
  return { report: { pages, templates: [], ...report }, outputs: pages.flatMap(page => page.outputs) }
}

/** @param {string} filepath */
async function missing (filepath) {
  await assert.rejects(lstat(filepath), { code: 'ENOENT' })
}

test('partial writes union ownership without cleanup or report mutation, then recover', async t => {
  const { dest, ledger, page, cache, write } = await fixture(t)
  assert.ok(ledger.cache instanceof Map)
  assert.equal(ledger.cache.size, 0)
  await write(['index.html', 'old.json'])
  const initial = result([page('page.js', ['index.html', 'old.json'])], { pageOutputCache: cache(['old.json']) })
  ledger.recordWrites(initial)
  await ledger.reconcileSuccessfulBuild(initial, { filtered: false })

  await write(['partial.json', 'second.json', 'unowned.json'])
  const partialCache = cache(['old.json', 'partial.json'])
  const partial = result([page('page.js', ['partial.json'])], { pageOutputCache: partialCache })
  const before = structuredClone(partial)
  Object.freeze(partial.report)
  ledger.recordWrites(partial)
  assert.equal(ledger.cache, partialCache)
  assert.deepEqual(partial, before)

  const unowned = page('ignored.js', ['unowned.json'])
  delete unowned.sourcePageFilePath
  ledger.recordWrites(result([page('page.js', ['second.json']), unowned]))
  assert.equal(ledger.cache, partialCache, 'absent cache does not reset previous writes')
  for (const name of ['old.json', 'partial.json', 'second.json']) {
    assert.equal(await readFile(join(dest, name), 'utf8'), name)
  }

  const recovery = result([page('page.js', ['index.html'])])
  ledger.recordWrites(recovery)
  await ledger.reconcileSuccessfulBuild(recovery, { filtered: false })
  for (const name of ['old.json', 'partial.json', 'second.json']) await missing(join(dest, name))
  assert.equal(await readFile(join(dest, 'index.html'), 'utf8'), 'index.html')
  assert.equal(await readFile(join(dest, 'unowned.json'), 'utf8'), 'unowned.json')
  assert.equal(ledger.cache.size, 0)
})

test('targeted builds preserve untouched owners and template claims, deleting only page-owned files', async t => {
  const { root, dest, ledger, output, page, cache, write } = await fixture(t)
  const names = ['index.html', 'old.json', 'other/index.html', 'feeds/shared.json', 'feeds/template.xml', 'claimed.json', 'static.txt']
  await write(names)
  const templatePath = join(root, 'feeds/feed.template.js')
  const initial = result([
    page('page.js', ['index.html', 'old.json', 'feeds/shared.json', 'claimed.json']),
    page('other/page.js', ['other/index.html']),
  ], {
    templates: [{
      templateInfo: {
        templateFile: { root, filepath: templatePath, relname: 'feeds/feed.template.js', basename: 'feed.template.js', parentName: 'feeds' },
        path: 'feeds',
        outputName: 'template.xml',
      },
      outputs: ['shared.json', 'template.xml'],
      type: 'array',
    }],
    pageOutputCache: cache(names),
  })
  ledger.recordWrites(initial)
  await ledger.reconcileSuccessfulBuild(initial, { filtered: false })

  const targeted = result([page('page.js', ['index.html'])])
  targeted.outputs.push(output('claimed.json'))
  ledger.recordWrites(targeted)
  await ledger.reconcileSuccessfulBuild(targeted, { filtered: true })
  await missing(join(dest, 'old.json'))
  for (const name of names.filter(name => name !== 'old.json')) {
    assert.equal(await readFile(join(dest, name), 'utf8'), name)
  }
  assert.deepEqual([...ledger.cache.keys()], [join(dest, 'index.html'), join(dest, 'other/index.html')])

  const full = result([page('page.js', ['index.html'])])
  ledger.recordWrites(full)
  await ledger.reconcileSuccessfulBuild(full, { filtered: false })
  await missing(join(dest, 'other/index.html'))
  for (const name of ['feeds/shared.json', 'feeds/template.xml', 'claimed.json', 'static.txt']) {
    assert.equal(await readFile(join(dest, name), 'utf8'), name, 'non-page ownership is not swept')
  }
  assert.deepEqual([...ledger.cache.keys()], [join(dest, 'index.html')])
})

test('shared page outputs stay owned and cached until the last page releases them', async t => {
  const { dest, ledger, page, cache, write } = await fixture(t)
  const names = ['one.html', 'two.html', 'shared.json']
  await write(names)
  const initial = result([
    page('one/page.js', ['one.html', 'shared.json']),
    page('two/page.js', ['two.html', 'shared.json']),
  ], { pageOutputCache: cache(names) })
  ledger.recordWrites(initial)
  await ledger.reconcileSuccessfulBuild(initial, { filtered: false })

  const first = result([page('one/page.js', ['one.html'])])
  ledger.recordWrites(first)
  await ledger.reconcileSuccessfulBuild(first, { filtered: true })
  assert.equal(await readFile(join(dest, 'shared.json'), 'utf8'), 'shared.json')
  assert.deepEqual([...ledger.cache.keys()], names.map(name => join(dest, name)))

  const second = result([page('two/page.js', ['two.html'])])
  ledger.recordWrites(second)
  await ledger.reconcileSuccessfulBuild(second, { filtered: true })
  await missing(join(dest, 'shared.json'))
  assert.deepEqual([...ledger.cache.keys()], [join(dest, 'one.html'), join(dest, 'two.html')])
})

test('generated pages share factory ownership and a targeted zero-output rebuild clears it', async t => {
  const { root, dest, ledger, page, cache, write } = await fixture(t)
  const names = ['one/index.html', 'one/data.json', 'two/index.html', 'untouched.html']
  await write(names)
  const owner = join(root, 'archive.pages.js')
  const initial = result([
    { ...page('one/page.js', ['one/index.html', 'one/data.json']), pagesFilePath: owner },
    { ...page('two/page.js', ['two/index.html']), pagesFilePath: owner },
    page('untouched/page.js', ['untouched.html']),
  ], { rebuiltPagesFilePaths: [owner], pageOutputCache: cache(names) })
  ledger.recordWrites(initial)
  await ledger.reconcileSuccessfulBuild(initial, { filtered: false })

  const partialNames = ['partial/one.json', 'partial/two.json']
  await write(partialNames)
  const partial = result(partialNames.map(name => ({
    ...page('generated/page.js', [name]),
    pagesFilePath: owner,
  })), { pageOutputCache: cache([...names, ...partialNames]) })
  ledger.recordWrites(partial)

  const unrelated = result([page('untouched/page.js', ['untouched.html'])])
  ledger.recordWrites(unrelated)
  await ledger.reconcileSuccessfulBuild(unrelated, { filtered: true })
  for (const name of [...names, ...partialNames]) {
    assert.equal(await readFile(join(dest, name), 'utf8'), name)
    assert.ok(ledger.cache.has(join(dest, name)))
  }

  const rebuilt = result([
    { ...page('one/page.js', ['one/index.html']), pagesFilePath: owner },
    { ...page('two/page.js', ['two/index.html']), pagesFilePath: owner },
  ], { rebuiltPagesFilePaths: [owner] })
  ledger.recordWrites(rebuilt)
  await ledger.reconcileSuccessfulBuild(rebuilt, { filtered: true })
  for (const name of ['one/data.json', ...partialNames]) {
    await missing(join(dest, name))
    assert.ok(!ledger.cache.has(join(dest, name)))
  }
  for (const name of ['one/index.html', 'two/index.html', 'untouched.html']) {
    assert.equal(await readFile(join(dest, name), 'utf8'), name)
    assert.ok(ledger.cache.has(join(dest, name)))
  }

  const empty = result([], { rebuiltPagesFilePaths: [owner] })
  ledger.recordWrites(empty)
  await ledger.reconcileSuccessfulBuild(empty, { filtered: true })
  for (const name of names.slice(0, 3)) await missing(join(dest, name))
  assert.equal(await readFile(join(dest, 'untouched.html'), 'utf8'), 'untouched.html')
  assert.deepEqual([...ledger.cache.keys()], [join(dest, 'untouched.html')])
})

test('cleanup failure retains old and newly recorded ownership and cache until recovery', async t => {
  const { dest, ledger, page, cache, write } = await fixture(t)
  await write(['removed.json', 'blocked.json'])
  const initial = result([page('page.js', ['removed.json', 'blocked.json'])])
  ledger.recordWrites(initial)
  await ledger.reconcileSuccessfulBuild(initial, { filtered: false })

  await write(['new.json'])
  const nextCache = cache(['removed.json', 'blocked.json', 'new.json'])
  const next = result([page('page.js', ['new.json'])], { pageOutputCache: nextCache })
  Object.freeze(next.report)
  ledger.recordWrites(next)
  const cause = Object.assign(new Error('cleanup denied'), { code: 'EACCES' })
  const originalRm = fs.rm
  /** @type {typeof fs.rm} */
  const failRemoval = async (path, options) => {
    if (path === join(dest, 'blocked.json')) throw cause
    return originalRm(path, options)
  }
  const removal = t.mock.method(fs, 'rm', failRemoval)
  syncBuiltinESMExports()
  try {
    await assert.rejects(ledger.reconcileSuccessfulBuild(next, { filtered: false }), error => error === cause)
  } finally {
    removal.mock.restore()
    syncBuiltinESMExports()
  }
  await missing(join(dest, 'removed.json'))
  assert.equal(await readFile(join(dest, 'blocked.json'), 'utf8'), 'blocked.json')
  assert.equal(await readFile(join(dest, 'new.json'), 'utf8'), 'new.json')
  assert.equal(ledger.cache, nextCache)
  assert.equal(ledger.cache.size, 3, 'cleanup failure must not prune cache')
  assert.equal(next.report.pageOutputCache, nextCache)

  const recovery = result()
  ledger.recordWrites(recovery)
  await ledger.reconcileSuccessfulBuild(recovery, { filtered: false })
  await missing(join(dest, 'blocked.json'))
  await missing(join(dest, 'new.json'))
  assert.equal(ledger.cache.size, 0)
})

test('failed targeted cleanup does not commit replacement template claims', async t => {
  const { root, dest, ledger, page, cache, write } = await fixture(t)
  const names = ['index.html', 'blocked.json', 'old-claim.json', 'new-claim.json']
  await write(names)
  const initial = result([page('page.js', ['index.html', 'blocked.json', 'old-claim.json'])], {
    templates: [{
      templateInfo: {
        templateFile: { root, filepath: join(root, 'feed.template.js'), relname: 'feed.template.js', basename: 'feed.template.js', parentName: '' },
        path: '',
        outputName: 'old-claim.json',
      },
      outputs: ['old-claim.json'],
      type: 'array',
    }],
  })
  ledger.recordWrites(initial)
  await ledger.reconcileSuccessfulBuild(initial, { filtered: false })

  const unchanged = result([page('page.js', ['index.html', 'blocked.json', 'old-claim.json'])])
  ledger.recordWrites(unchanged)
  await ledger.reconcileSuccessfulBuild(unchanged, { filtered: true })

  const nextCache = cache(names)
  const next = result([page('page.js', ['index.html', 'new-claim.json'])], {
    templates: initial.report.templates.map(report => ({ ...report, outputs: ['new-claim.json'] })),
    pageOutputCache: nextCache,
  })
  ledger.recordWrites(next)
  const cause = Object.assign(new Error('cleanup denied'), { code: 'EACCES' })
  const originalRm = fs.rm
  /** @type {typeof fs.rm} */
  const failRemoval = async (path, options) => {
    if (path === join(dest, 'blocked.json')) throw cause
    return originalRm(path, options)
  }
  const removal = t.mock.method(fs, 'rm', failRemoval)
  syncBuiltinESMExports()
  try {
    await assert.rejects(ledger.reconcileSuccessfulBuild(next, { filtered: true }), error => error === cause)
  } finally {
    removal.mock.restore()
    syncBuiltinESMExports()
  }
  assert.equal(ledger.cache, nextCache)
  assert.equal(ledger.cache.size, names.length)

  const recovery = result([page('page.js', ['index.html'])])
  ledger.recordWrites(recovery)
  await ledger.reconcileSuccessfulBuild(recovery, { filtered: true })
  assert.equal(await readFile(join(dest, 'old-claim.json'), 'utf8'), 'old-claim.json')
  await missing(join(dest, 'blocked.json'))
  await missing(join(dest, 'new-claim.json'))
  assert.deepEqual([...ledger.cache.keys()], [join(dest, 'index.html')])
})

test('cleanup never follows symlink ancestors or removes directories, but unlinks output symlinks', async t => {
  const { root, dest, ledger, page, write } = await fixture(t)
  await write(['nested/data.json', 'leaf.json', 'directory', 'gone/data.json', 'file-parent/data.json'])
  const initial = result([page('page.js', ['nested/data.json', 'leaf.json', 'directory', 'gone/data.json', 'file-parent/data.json'])])
  ledger.recordWrites(initial)
  await ledger.reconcileSuccessfulBuild(initial, { filtered: false })

  const outside = join(root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'data.json'), 'outside')
  await rm(join(dest, 'nested'), { recursive: true })
  await symlink(outside, join(dest, 'nested'), 'dir')
  await rm(join(dest, 'leaf.json'))
  await symlink(join(outside, 'data.json'), join(dest, 'leaf.json'))
  await rm(join(dest, 'directory'))
  await mkdir(join(dest, 'directory'))
  await rm(join(dest, 'gone'), { recursive: true })
  await rm(join(dest, 'file-parent'), { recursive: true })
  await writeFile(join(dest, 'file-parent'), 'not a directory')

  const empty = result()
  ledger.recordWrites(empty)
  await ledger.reconcileSuccessfulBuild(empty, { filtered: false })
  assert.equal(await readFile(join(outside, 'data.json'), 'utf8'), 'outside')
  assert.ok((await lstat(join(dest, 'nested'))).isSymbolicLink())
  assert.ok((await lstat(join(dest, 'directory'))).isDirectory())
  assert.equal(await readFile(join(dest, 'file-parent'), 'utf8'), 'not a directory')
  await missing(join(dest, 'leaf.json'))
})

test('cleanup also refuses to follow a replaced destination symlink', async t => {
  const { root, dest, ledger, page, write } = await fixture(t)
  await write(['data.json'])
  ledger.recordWrites(result([page('page.js', ['data.json'])]))
  const outside = join(root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'data.json'), 'outside')
  await rm(dest, { recursive: true })
  await symlink(outside, dest, 'dir')
  await ledger.reconcileSuccessfulBuild(result(), { filtered: false })
  assert.equal(await readFile(join(outside, 'data.json'), 'utf8'), 'outside')
  assert.ok((await lstat(dest)).isSymbolicLink())
})

for (const name of ['../outside.json', '.']) {
  test(`cleanup rejects unsafe ownership path ${name}`, async t => {
    const { root, dest, ledger, page, cache } = await fixture(t)
    const outside = join(root, 'outside.json')
    await writeFile(outside, 'outside')
    const recorded = result([page('page.js', [name])], { pageOutputCache: cache([name]) })
    ledger.recordWrites(recorded)
    await assert.rejects(ledger.reconcileSuccessfulBuild(result(), { filtered: false }), /escapes dest|Refusing to remove the build destination/)
    assert.equal(await readFile(outside, 'utf8'), 'outside')
    assert.ok((await lstat(dest)).isDirectory())
    assert.equal(ledger.cache.size, 1)
  })
}
